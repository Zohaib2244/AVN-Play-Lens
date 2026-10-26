using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace AVN.QA.Editor
{
    /// <summary>Menu items to switch the Android build between QA and release.</summary>
    public static class AVNQAMenu
    {
        const string Enable = "AVN/QA/Enable QA build (AVN_QA + Development Build)";
        const string Disable = "AVN/QA/Disable QA build";
        const string Status = "AVN/QA/Show QA build status";

        static NamedBuildTarget Android => NamedBuildTarget.Android;

        [MenuItem(Enable)]
        static void EnableQa()
        {
            AVNQABuildGuard.SetDefine(Android, AVNQABuildGuard.Define, true);
            EditorUserBuildSettings.development = true;
            Debug.Log("[AVNQA] QA build enabled for Android: AVN_QA defined, Development Build on.");
        }

        [MenuItem(Disable)]
        static void DisableQa()
        {
            AVNQABuildGuard.SetDefine(Android, AVNQABuildGuard.Define, false);
            AVNQABuildGuard.SetDefine(Android, AVNQABuildGuard.AllowReleaseDefine, false);
            Debug.Log("[AVNQA] QA build disabled for Android: AVN_QA removed. Development Build left as is.");
        }

        [MenuItem(Status)]
        static void ShowStatus()
        {
            var defines = AVNQABuildGuard.GetDefines(Android);
            bool qa = System.Array.IndexOf(defines, AVNQABuildGuard.Define) >= 0;
            EditorUtility.DisplayDialog("AVN QA build status",
                "Android scripting defines: " + string.Join(";", defines) + "\n\n" +
                "AVN_QA: " + (qa ? "ON (QA bridge compiled in)" : "off (bridge absent)") + "\n" +
                "Development Build: " + (EditorUserBuildSettings.development ? "on" : "off") + "\n" +
                "Bridge port: " + AVNQASettings.Port, "OK");
        }
    }
}
