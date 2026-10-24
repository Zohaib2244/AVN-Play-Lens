#if AVN_QA
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

namespace AVN.QA
{
    /// <summary>
    /// Lists the interactable uGUI controls currently on screen with their normalised
    /// screen rectangles. PlayLens multiplies the normalised values by the phone's
    /// physical display size and taps through ADB, so the input path is the real one.
    /// Coordinates use a top-left origin (ADB convention), not Unity's bottom-left.
    /// </summary>
    internal static class AVNQAUiScan
    {
        static readonly Vector3[] Corners = new Vector3[4];

        public static Dictionary<string, object> Screen()
        {
            return new Dictionary<string, object>
            {
                { "width", UnityEngine.Screen.width },
                { "height", UnityEngine.Screen.height },
                { "dpi", UnityEngine.Screen.dpi },
                { "orientation", UnityEngine.Screen.orientation.ToString() },
                { "safeArea", Rect(UnityEngine.Screen.safeArea) },
            };
        }

        public static List<object> Controls()
        {
            var list = new List<object>();
            int w = UnityEngine.Screen.width, h = UnityEngine.Screen.height;
            if (w <= 0 || h <= 0) return list;

            // FindObjectsByType exists since 2021.3; Selectable covers Button, Toggle, Slider, InputField, Dropdown.
            var selectables = UnityEngine.Object.FindObjectsByType<Selectable>(FindObjectsSortMode.None);
            foreach (var s in selectables)
            {
                if (s == null || !s.isActiveAndEnabled) continue;
                var rt = s.transform as RectTransform;
                if (rt == null) continue;
                var canvas = s.GetComponentInParent<Canvas>();
                if (canvas == null || !canvas.isActiveAndEnabled) continue;
                var group = s.GetComponentInParent<CanvasGroup>();
                if (group != null && (!group.interactable || !group.blocksRaycasts || group.alpha <= 0.01f)) continue;

                var cam = canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : canvas.worldCamera;
                rt.GetWorldCorners(Corners);
                float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
                for (int i = 0; i < 4; i++)
                {
                    Vector2 p = RectTransformUtility.WorldToScreenPoint(cam, Corners[i]);
                    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
                }
                if (maxX <= 0 || maxY <= 0 || minX >= w || minY >= h) continue; // fully off screen

                // Unity screen y is bottom-up; flip to top-down for ADB.
                float top = h - maxY, bottom = h - minY;
                var rect = new Dictionary<string, object>
                {
                    { "x", Clamp01(minX / w) }, { "y", Clamp01(top / h) },
                    { "w", Clamp01((maxX - minX) / w) }, { "h", Clamp01((bottom - top) / h) },
                };
                var center = new Dictionary<string, object>
                {
                    { "x", Clamp01((minX + maxX) * 0.5f / w) },
                    { "y", Clamp01((top + bottom) * 0.5f / h) },
                };

                list.Add(new Dictionary<string, object>
                {
                    { "id", Path(s.transform) },
                    { "name", s.gameObject.name },
                    { "type", s.GetType().Name },
                    { "label", Label(s.transform) },
                    { "interactable", s.IsInteractable() },
                    { "rect", rect },
                    { "center", center },
                });
            }
            return list;
        }

        /// <summary>Find a control by id (hierarchy path), name or label. Null when absent.</summary>
        public static Dictionary<string, object> Find(string query)
        {
            if (string.IsNullOrEmpty(query)) return null;
            Dictionary<string, object> byName = null, byLabel = null;
            foreach (Dictionary<string, object> c in Controls())
            {
                if (string.Equals((string)c["id"], query, StringComparison.Ordinal)) return c;
                if (byName == null && string.Equals((string)c["name"], query, StringComparison.OrdinalIgnoreCase)) byName = c;
                if (byLabel == null && string.Equals((string)c["label"], query, StringComparison.OrdinalIgnoreCase)) byLabel = c;
            }
            return byName ?? byLabel;
        }

        static string Path(Transform t)
        {
            var sb = new StringBuilder(t.name);
            while (t.parent != null)
            {
                t = t.parent;
                sb.Insert(0, '/').Insert(0, t.name);
            }
            return sb.ToString();
        }

        static string Label(Transform t)
        {
            var text = t.GetComponentInChildren<Text>(true);
            if (text != null && !string.IsNullOrEmpty(text.text)) return text.text.Trim();
            // TextMeshPro without a hard dependency: any child component whose type name starts with "TMP_Text"
            // or "TextMeshPro" and exposes a string "text" property.
            foreach (var comp in t.GetComponentsInChildren<Component>(true))
            {
                if (comp == null) continue;
                var type = comp.GetType();
                if (!type.Name.StartsWith("TextMeshPro", StringComparison.Ordinal) && !type.Name.StartsWith("TMP_Text", StringComparison.Ordinal)) continue;
                var prop = type.GetProperty("text", BindingFlags.Instance | BindingFlags.Public);
                if (prop == null || prop.PropertyType != typeof(string)) continue;
                var value = prop.GetValue(comp) as string;
                if (!string.IsNullOrEmpty(value)) return value.Trim();
            }
            return null;
        }

        static Dictionary<string, object> Rect(Rect r)
        {
            return new Dictionary<string, object> { { "x", r.x }, { "y", r.y }, { "w", r.width }, { "h", r.height } };
        }

        static double Clamp01(float v) => Math.Round(Mathf.Clamp01(v), 4);
    }
}
#endif
