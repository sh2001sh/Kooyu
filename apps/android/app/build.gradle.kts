plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
val terminalAssets = tasks.register<Sync>("copyTerminalAssets") {
    val bundled = rootProject.file("../ios/Kooyu/TerminalAssets")
    from(bundled) { include("xterm.js", "xterm.css", "LICENSE") }
    into(layout.buildDirectory.dir("generated/terminalAssets/terminal"))
    doFirst { require(bundled.resolve("xterm.js").isFile) { "Bundled terminal assets are missing." } }
}
android {
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/terminalAssets"))
    namespace = "app.kooyu.android"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.kooyu.android"
        for ((field, variable) in listOf("ACCOUNT_ORIGIN" to "KOOYU_OFFICIAL_ACCOUNT_ORIGIN", "RELAY_ORIGIN" to "KOOYU_OFFICIAL_RELAY_ORIGIN")) {
            val origin = System.getenv(variable).orEmpty()
            require(origin.isEmpty() || Regex("https://[a-zA-Z0-9.-]+(:[0-9]+)?").matches(origin))
            if(System.getenv("KOOYU_OFFICIAL_RELEASE")=="1") require(origin.isNotEmpty()) { "Missing "+variable }
            buildConfigField("String",field,"\""+origin+"\"")
        }
        minSdk = 26
        targetSdk = 36
        versionCode = 6
        versionName = "1.0.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs.getByName("debug") {
        System.getenv("KOOYU_ANDROID_DEBUG_KEYSTORE")?.let { storeFile = file(it) }
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
tasks.named("preBuild") { dependsOn(terminalAssets) }
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.10.01"))
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("com.nimbusds:nimbus-jose-jwt:10.5")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.79")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("io.noties.markwon:core:4.6.2")
    implementation("io.noties.markwon:ext-tables:4.6.2")
    implementation("io.noties.markwon:ext-strikethrough:4.6.2")
    implementation("io.noties.markwon:ext-tasklist:4.6.2")
    implementation("io.noties.markwon:linkify:4.6.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

