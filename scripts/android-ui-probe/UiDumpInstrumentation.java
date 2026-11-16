package app.kooyu.qaprobe;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.Bundle;
import android.util.Xml;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.StringWriter;
import org.xmlpull.v1.XmlSerializer;

/** Read-only accessibility capture. No Activity, permissions, network, or user data access. */
public final class UiDumpInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            UiAutomation automation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            // Connecting accessibility is asynchronous. An immediate root may be the
            // previous Compose screen even though the display already changed.
            try { automation.waitForIdle(150, 2500); } catch (java.util.concurrent.TimeoutException ignored) { }
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            for (int i = 0; root == null && i < 10; i++) {
                Thread.sleep(100);
                root = automation.getRootInActiveWindow();
            }
            if (root == null) throw new IllegalStateException("No active accessibility root");
            root.refresh();
            StringWriter writer = new StringWriter();
            XmlSerializer xml = Xml.newSerializer();
            xml.setOutput(writer);
            xml.startDocument("UTF-8", true);
            xml.startTag(null, "hierarchy");
            emit(xml, root, 0, 0);
            xml.endTag(null, "hierarchy");
            xml.endDocument();
            root.recycle();
            result.putString("stream", "KOOYU_UI_XML_BEGIN" + writer + "KOOYU_UI_XML_END");
            finish(Activity.RESULT_OK, result);
        } catch (Exception error) {
            result.putString("stream", "Kooyu QA probe failed: " + error);
            finish(Activity.RESULT_CANCELED, result);
        }
    }
    private static String text(CharSequence value) { return value == null ? "" : value.toString(); }
    private static void emit(XmlSerializer xml, AccessibilityNodeInfo node, int index, int depth) throws Exception {
        if (depth > 100 || !node.isVisibleToUser()) return;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        xml.startTag(null, "node");
        xml.attribute(null, "index", Integer.toString(index));
        xml.attribute(null, "text", node.isPassword() ? "" : text(node.getText()));
        xml.attribute(null, "content-desc", text(node.getContentDescription()));
        xml.attribute(null, "resource-id", text(node.getViewIdResourceName()));
        xml.attribute(null, "class", text(node.getClassName()));
        xml.attribute(null, "package", text(node.getPackageName()));
        xml.attribute(null, "bounds", bounds.toShortString());
        xml.attribute(null, "enabled", Boolean.toString(node.isEnabled()));
        xml.attribute(null, "clickable", Boolean.toString(node.isClickable()));
        xml.attribute(null, "scrollable", Boolean.toString(node.isScrollable()));
        xml.attribute(null, "focused", Boolean.toString(node.isFocused()));
        xml.attribute(null, "checked", Boolean.toString(node.isChecked()));
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) { emit(xml, child, i, depth + 1); child.recycle(); }
        }
        xml.endTag(null, "node");
    }
}
