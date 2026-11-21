package app.kooyu.android

import com.nimbusds.jose.*
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest
import java.util.Base64
import java.util.Date
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Serialized only inside ConnectionVault. The Relay and issuer come from release configuration. */
internal class CloudDevice(val base: HttpUrl, val data: JSONObject, private var invitation: Map<String,String>? = null) {
    private val issuer = BuildConfig.ACCOUNT_ORIGIN
    private val key = ECKey.parse(data.getString("key"))
    private var ticket = ""
    private var until = 0L
    init {
        require(issuer.startsWith("https://") && issuer.toHttpUrl().encodedPath == "/")
        val origin = base.newBuilder().encodedPath("/").query(null).build().toString().trimEnd('/')
        require(invitation != null || origin == BuildConfig.RELAY_ORIGIN || origin == data.optString("directOrigin"))
    }
    private fun hash(text:String) = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(text.toByteArray()))
    private fun proof(url:String, method:String, nonce:String, token:String):String {
        val claims=JWTClaimsSet.Builder().jwtID(UUID.randomUUID().toString()).issueTime(Date()).claim("htu",url).claim("htm",method).claim("nonce",nonce).claim("ath",hash(token)).build()
        return SignedJWT(JWSHeader.Builder(JWSAlgorithm.ES256).type(JOSEObjectType("dpop+jwt")).jwk(key.toPublicJWK()).build(),claims).apply { sign(ECDSASigner(key)) }.serialize()
    }
    private fun send(url:String,body:JSONObject,headers:Map<String,String> = emptyMap()):JSONObject {
        val req=Request.Builder().url(url).post(body.toString().toRequestBody("application/json".toMediaType()))
        headers.forEach { (k,v)-> req.header(k,v) }
        return raw.newCall(req.build()).execute().use {
            if(!it.isSuccessful)throw IOException("设备授权失败（"+it.code+"）")
            JSONObject(it.body?.string() ?: throw IOException("设备授权服务无响应"))
        }
    }
    private fun step(path:String,body:JSONObject,token:String?=null,nonce:String=""):JSONObject {
        val url=issuer+"/api/device-auth/v1/"+path
        return send(url,body,if(token==null) emptyMap() else mapOf("Authorization" to "DPoP "+token,"DPoP" to proof(url,"POST",nonce,token)))
    }
    private fun pair(path:String):JSONObject {
        val inv=requireNotNull(invitation);val token=inv.getValue("claim")
        return step("pairing/"+path,JSONObject().put("secret",token).put("transactionId",inv.getValue("transaction")).put("name","Kooyu Android"),token,hash(token))
    }
    private var discoveryCode=""
    private var discoverySession=""
    suspend fun beginLogin():String=withContext(Dispatchers.IO){
        val r=step("discovery/start",JSONObject().put("name","Kooyu Android").put("jkt",key.computeThumbprint().toString()))
        discoveryCode=r.getString("deviceCode");r.getString("userCode")
    }
    suspend fun discover():List<JSONObject> = withContext(Dispatchers.IO){
        val deadline=System.currentTimeMillis()+300000
        while(discoverySession.isEmpty() && System.currentTimeMillis()<deadline){
            kotlinx.coroutines.delay(5500)
            val r=step("discovery/poll",JSONObject().put("deviceCode",discoveryCode),discoveryCode,hash(discoveryCode))
            if(r.optString("state")=="approved")discoverySession=r.getString("token")
        }
        if(discoverySession.isEmpty())throw IOException("登录申请已到期。")
        val hosts = mutableListOf<JSONObject>()
        var cursor = ""
        do {
            val nonce = step("nonce",JSONObject()).getString("nonce")
            val body = JSONObject().put("nonce",nonce)
            if(cursor.isNotEmpty()) body.put("cursor",cursor)
            val page = step("discovery/hosts",body,discoverySession,nonce)
            val items = page.getJSONArray("items")
            for(index in 0 until items.length()) hosts.add(items.getJSONObject(index))
            cursor = if(page.isNull("nextCursor")) "" else page.getString("nextCursor")
        } while(cursor.isNotEmpty())
        hosts
    }
    suspend fun requestHost(host:JSONObject):PairingInvitation=withContext(Dispatchers.IO){
        val nonce=step("nonce",JSONObject()).getString("nonce")
        val r=step("discovery/request",JSONObject().put("name","Kooyu Android").put("hostId",host.getString("id")).put("nonce",nonce),discoverySession,nonce)
        PairingInvitation(BuildConfig.RELAY_ORIGIN+"/h/"+host.getString("relay_id"),"V2-REQUEST&transaction="+r.getString("transactionId")+"&claim="+r.getString("secret")+"&host="+host.getString("id"))
    }
    suspend fun finish() = withContext(Dispatchers.IO){
        val value=pair("finish");require(value.getString("state")=="active")
        data.put("renewal",value.getString("renewal"));invitation=null;until=0
    }
    @Synchronized private fun accessTicket():String {
        if(System.currentTimeMillis()<until)return ticket
        val nonce=step("nonce",JSONObject()).getString("nonce")
        val id = key.computeThumbprint().toString()
        val token=invitation?.get("claim") ?: vault?.renewal(id)?.takeIf { it.isNotEmpty() } ?: data.getString("renewal")
        val response=step("ticket",JSONObject().put("rotate",vault!=null).put("nonce",nonce).put("role",if(invitation==null)"device" else "pair").put("hostId",data.getString("hostId")),token,nonce)
        if(response.has("renewal")){val renewed=response.getString("renewal");vault?.saveRenewal(id,renewed);data.put("renewal",renewed)}
        ticket=response.getString("ticket")
        until=System.currentTimeMillis()+540000;return ticket
    }
    private fun authorize(request: Request):Request {
        val token=accessTicket()
        val nonce=send(base.newBuilder().encodedPath("/v1/nonce").query(null).build().toString(),JSONObject()).getString("nonce")
        val target=request.url.newBuilder().query(null).fragment(null).build().toString()
        return request.newBuilder().header("X-Kooyu-Ticket",token).header("X-Kooyu-Purpose",if(invitation==null)"access" else "pair").header("DPoP",proof(target,request.method,nonce,token)).build()
    }
    companion object : Interceptor {
        internal var vault: ConnectionVault? = null
        private val devices=ConcurrentHashMap<String,CloudDevice>()
        private val raw=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).callTimeout(10,java.util.concurrent.TimeUnit.SECONDS).build()
        private fun route(base:HttpUrl)=base.toString().trimEnd('/')
        fun restore(c:Connection){c.cloud?.let { saved -> val base=HostAPI.origin(c.url);devices.computeIfAbsent(route(base)){CloudDevice(base,saved)} }}
        suspend fun logout(connection:Connection) = withContext(Dispatchers.IO) {
            if(connection.cloud==null)return@withContext
            restore(connection)
            val route=route(HostAPI.origin(connection.url))
            val device=requireNotNull(devices[route])
            val id=device.key.computeThumbprint().toString()
            val token=vault?.renewal(id)?.takeIf {it.isNotEmpty()} ?: device.data.getString("renewal")
            val nonce=device.step("nonce",JSONObject()).getString("nonce")
            device.step("logout",JSONObject().put("nonce",nonce),token,nonce)
            devices.remove(route)
            vault?.saveRenewal(id,"")
            Unit
        }
        fun login():CloudDevice=CloudDevice(BuildConfig.RELAY_ORIGIN.toHttpUrl(),JSONObject().put("key",ECKeyGenerator(Curve.P_256).generate().toJSONString()))
        suspend fun start(base:HttpUrl,inv:Map<String,String>):CloudDevice=withContext(Dispatchers.IO){
            val data=JSONObject().put("key",ECKeyGenerator(Curve.P_256).generate().toJSONString()).put("hostId",inv.getValue("host"))
            val device=CloudDevice(base,data,inv)
            val deadline=System.currentTimeMillis()+300000
            var result=device.pair("claim")
            while(result.getString("state")=="approval_required"){
                if(System.currentTimeMillis()>=deadline)throw IOException("电脑批准请求已到期。")
                kotlinx.coroutines.delay(5000)
                result=device.pair("claim")
            }
            val origin=base.newBuilder().encodedPath("/").query(null).build().toString().trimEnd('/')
            if(origin!=BuildConfig.RELAY_ORIGIN){
                require(result.optString("directOrigin")==origin && base.encodedPath.trimEnd('/')=="/h/"+result.getString("relayHostId"))
                data.put("directOrigin",origin)
            }
            devices[route(base)]=device;device
        }
        override fun intercept(chain:Interceptor.Chain):Response{
            val request=chain.request()
            val path=request.url.encodedPath
            val host=Regex("^/(?:h|v2/mailbox)/([a-f0-9]{64})(?:/|$)").find(path)?.groupValues?.get(1)
            val account=host?.let { devices[request.url.newBuilder().encodedPath("/h/"+it).query(null).build().toString()] }
            return chain.proceed(account?.authorize(request) ?: request)
        }
    }
}


