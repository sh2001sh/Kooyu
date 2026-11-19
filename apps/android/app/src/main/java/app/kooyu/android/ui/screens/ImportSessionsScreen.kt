package app.kooyu.android.ui.screens

import app.kooyu.android.*
import app.kooyu.android.ui.components.*
import app.kooyu.android.ui.theme.*

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

private data class ImportCandidateRow(
    val harnessId: String,
    val nativeSessionId: String,
    val title: String,
    val cwd: String?,
    val projectId: String?,
    val workspaceId: String?,
    val model: String?,
    val updatedAt: String?,
    val alreadyImported: Boolean,
    val existingSessionId: String?,
) {
    val key: String get() = "$harnessId:$nativeSessionId"

    companion object {
        fun parse(o: JSONObject) = ImportCandidateRow(
            harnessId = o.optString("harnessId"),
            nativeSessionId = o.optString("nativeSessionId"),
            title = o.optString("title").ifBlank { o.optString("nativeSessionId").take(8) },
            cwd = o.nullableString("cwd"),
            projectId = o.nullableString("projectId"),
            workspaceId = o.nullableString("workspaceId"),
            model = o.nullableString("model"),
            updatedAt = o.nullableString("updatedAt") ?: o.nullableString("createdAt"),
            alreadyImported = o.optBoolean("alreadyImported", false),
            existingSessionId = o.nullableString("existingSessionId"),
        )
    }
}

@Composable fun ImportSessionsScreen(
    state: WorkbenchState,
    model: Workbench,
    onClose: () -> Unit,
    onOpenSession: ((String) -> Unit)? = null,
) {
    val c = Kooyu.colors
    val scope = rememberCoroutineScope()
    var projectFilter by remember { mutableStateOf("") }
    var harnessFilter by remember { mutableStateOf("") }
    var candidates by remember { mutableStateOf<List<ImportCandidateRow>>(emptyList()) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var loading by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    var statusText by remember { mutableStateOf<String?>(null) }

    fun scan(proj: String = projectFilter, eng: String = harnessFilter) {
        scope.launch {
            loading = true
            statusText = null
            val qs = buildList {
                if (proj.isNotEmpty()) add("projectId=${URLEncoder.encode(proj, "UTF-8")}")
                if (eng.isNotEmpty()) add("harnessId=${URLEncoder.encode(eng, "UTF-8")}")
            }.joinToString("&")
            val res = model.read("/native-imports" + if (qs.isNotEmpty()) "?$qs" else "")
            val parsed = res?.optJSONArray("candidates")?.objects()?.map(ImportCandidateRow::parse) ?: emptyList()
            candidates = parsed
            val valid = parsed.filter { !it.alreadyImported }.map { it.key }.toSet()
            selected = selected.intersect(valid)
            loading = false
        }
    }

    LaunchedEffect(state.connection?.hostId, projectFilter, harnessFilter) {
        scan(projectFilter, harnessFilter)
    }

    val importable = remember(candidates) { candidates.filter { !it.alreadyImported } }
    val projectNames = remember(state.projects) { state.projects.toMap() }

    FullScreenPage(kooyuT("import.title"), onClose) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .background(c.navigator)
                .padding(padding)
        ) {
            // Project & Engine filter strip
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                var projMenu by remember { mutableStateOf(false) }
                Box {
                    FilterChip(
                        selected = projectFilter.isNotEmpty(),
                        onClick = { projMenu = true },
                        label = {
                            Text(
                                projectNames[projectFilter] ?: kooyuT("import.allProjects"),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        },
                        trailingIcon = { Icon(Icons.Outlined.ExpandMore, null, Modifier.size(16.dp)) }
                    )
                    DropdownMenu(expanded = projMenu, onDismissRequest = { projMenu = false }) {
                        DropdownMenuItem(
                            text = { Text(kooyuT("import.allProjects")) },
                            onClick = { projMenu = false; projectFilter = "" }
                        )
                        state.projects.forEach { (id, name) ->
                            DropdownMenuItem(
                                text = { Text(name) },
                                onClick = { projMenu = false; projectFilter = id }
                            )
                        }
                    }
                }

                var engMenu by remember { mutableStateOf(false) }
                Box {
                    FilterChip(
                        selected = harnessFilter.isNotEmpty(),
                        onClick = { engMenu = true },
                        label = {
                            Text(
                                state.harnesses.firstOrNull { it.id == harnessFilter }?.name ?: kooyuT("import.allEngines"),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        },
                        trailingIcon = { Icon(Icons.Outlined.ExpandMore, null, Modifier.size(16.dp)) }
                    )
                    DropdownMenu(expanded = engMenu, onDismissRequest = { engMenu = false }) {
                        DropdownMenuItem(
                            text = { Text(kooyuT("import.allEngines")) },
                            onClick = { engMenu = false; harnessFilter = "" }
                        )
                        state.harnesses.filter { it.id != "cursor" }.forEach { h ->
                            DropdownMenuItem(
                                text = { Text(h.name) },
                                onClick = { engMenu = false; harnessFilter = h.id }
                            )
                        }
                    }
                }

                AssistChip(
                    onClick = { scan() },
                    enabled = !loading,
                    label = { Text(kooyuT("import.scan")) },
                    leadingIcon = { Icon(Icons.Outlined.Refresh, null, Modifier.size(16.dp)) }
                )
            }

            if (importable.isNotEmpty()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 2.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "${selected.size} / ${importable.size}",
                        fontSize = 12.sp,
                        color = c.textTertiary
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { selected = importable.map { it.key }.toSet() }) {
                            Text(kooyuT("import.selectAll"), fontSize = 12.sp)
                        }
                        if (selected.isNotEmpty()) {
                            TextButton(onClick = { selected = emptySet() }) {
                                Text(kooyuT("import.clear"), fontSize = 12.sp, color = c.textSecondary)
                            }
                        }
                    }
                }
            }

            statusText?.let { msg ->
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = c.raised,
                    border = BorderStroke(0.5.dp, c.success),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
                ) {
                    Text(msg, fontSize = 13.sp, color = c.success, modifier = Modifier.padding(12.dp))
                }
            }

            if (loading && candidates.isEmpty()) {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator(strokeWidth = 2.dp, color = c.text)
                        Text(kooyuT("import.scanning"), fontSize = 13.sp, color = c.textSecondary)
                    }
                }
            } else if (candidates.isEmpty()) {
                Box(Modifier.weight(1f).fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text(kooyuT("import.empty"), fontSize = 13.5.sp, color = c.textSecondary)
                }
            } else {
                LazyColumn(
                    Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(candidates, key = { it.key }) { item ->
                        val isChecked = item.key in selected
                        val projLabel = item.projectId?.let { projectNames[it] } ?: kooyuT("import.unassigned")
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = c.raised,
                            border = BorderStroke(
                                if (isChecked) 1.dp else 0.5.dp,
                                if (isChecked) c.accent else c.borderSubtle
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !item.alreadyImported) {
                                    selected = if (isChecked) selected - item.key else selected + item.key
                                }
                        ) {
                            Row(
                                Modifier.padding(horizontal = 12.dp, vertical = 11.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Box(
                                    Modifier
                                        .size(20.dp)
                                        .clip(CircleShape)
                                        .background(
                                            when {
                                                item.alreadyImported -> c.success.copy(alpha = 0.16f)
                                                isChecked -> c.accent
                                                else -> c.sunken
                                            }
                                        ),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (isChecked || item.alreadyImported) {
                                        Icon(
                                            Icons.Outlined.Check,
                                            null,
                                            tint = if (item.alreadyImported) c.success else c.onAccent,
                                            modifier = Modifier.size(13.dp)
                                        )
                                    }
                                }
                                EngineBadge(item.harnessId, 30.dp, circle = false)
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(
                                        item.title,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = c.text,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        listOfNotNull(
                                            projLabel,
                                            item.model?.substringAfterLast('/'),
                                            item.updatedAt?.take(16)?.replace('T', ' ')
                                        ).joinToString(" · "),
                                        fontSize = 11.5.sp,
                                        color = c.textTertiary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                if (item.alreadyImported) {
                                    Surface(
                                        shape = RoundedCornerShape(999.dp),
                                        color = c.sunken,
                                        border = BorderStroke(0.5.dp, c.borderSubtle)
                                    ) {
                                        Text(
                                            kooyuT("import.importedTag"),
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Medium,
                                            color = c.textSecondary
                                        )
                                    }
                                    if (item.existingSessionId != null && onOpenSession != null) {
                                        IconButton(onClick = { onOpenSession(item.existingSessionId) }) {
                                            Icon(Icons.Outlined.ChevronRight, null, tint = c.textSecondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Surface(
                color = c.raised,
                border = BorderStroke(0.5.dp, c.borderSubtle),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val doneLabel = kooyuT("import.done")
                    Button(
                        enabled = state.canWrite && selected.isNotEmpty() && !importing,
                        colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                        onClick = {
                            val chosen = candidates.filter { !it.alreadyImported && it.key in selected }
                            if (chosen.isEmpty()) return@Button
                            scope.launch {
                                importing = true
                                val arr = JSONArray()
                                chosen.forEach { row ->
                                    arr.put(
                                        JSONObject()
                                            .put("harnessId", row.harnessId)
                                            .put("nativeSessionId", row.nativeSessionId)
                                            .put("title", row.title)
                                            .apply {
                                                if (row.cwd != null) put("cwd", row.cwd)
                                                if (row.projectId != null) put("projectId", row.projectId)
                                                if (row.workspaceId != null) put("workspaceId", row.workspaceId)
                                                if (row.model != null) put("model", row.model)
                                            }
                                    )
                                }
                                val body = JSONObject().put("items", arr).apply {
                                    if (projectFilter.isNotEmpty()) put("projectId", projectFilter)
                                }
                                val res = model.execute("/native-imports", "POST", body)
                                importing = false
                                if (res != null) {
                                    val count = res.optJSONArray("imported")?.length() ?: 0
                                    statusText = "$doneLabel ($count)"
                                    selected = emptySet()
                                    model.refresh()
                                    scan(projectFilter, harnessFilter)
                                }
                            }
                        }
                    ) {
                        Text(
                            if (importing) kooyuT("import.importing")
                            else "${kooyuT("import.importBtn")} (${selected.size})"
                        )
                    }
                }
            }
        }
    }
}
