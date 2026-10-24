using System;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace AVN.QA.Editor
{
    /// <summary>
    /// Stops a release build that still carries the QA bridge. A build with AVN_QA must be a
    /// Development Build; set AVN_QA_ALLOW_RELEASE as well to override deliberately.
    /// </summary>
    public sealed class AVNQABuildGuard : IPreprocessBuildWithReport
    {
        public const string Define = "AVN_QA";
        public const string AllowReleaseDefine = "AVN_QA_ALLOW_RELEASE";

        public int callbackOrder => -100;

        public void OnPreprocessBuild(BuildReport report)
        {
            var target = NamedBuildTarget.FromBuildTargetGroup(BuildPipeline.GetBuildTargetGroup(report.summary.platform));
            var defines = GetDefines(target);
            bool qa = defines.Contains(Define);
            bool allow = defines.Contains(AllowReleaseDefine);
            bool development = (report.summary.options & BuildOptions.Development) != 0;

            if (qa && !development && !allow)
            {
                throw new BuildFailedException(
                    "AVN QA: the AVN_QA define is set but this is not a Development Build. " +
                    "The QA bridge must not ship in a release. Remove AVN_QA (menu AVN > QA > Disable QA build) " +
                    "or tick Development Build, or add AVN_QA_ALLOW_RELEASE if you really mean it.");
            }
            if (qa) Debug.Log("[AVNQA] Building a QA build (AVN_QA set, development=" + development + ").");
        }

        public static string[] GetDefines(NamedBuildTarget target)
        {
            PlayerSettings.GetScriptingDefineSymbols(target, out var defines);
            return defines ?? Array.Empty<string>();
        }

        public static void SetDefine(NamedBuildTarget target, string define, bool on)
        {
            var defines = GetDefines(target).ToList();
            bool has = defines.Contains(define);
            if (on && !has) defines.Add(define);
            if (!on && has) defines.Remove(define);
            PlayerSettings.SetScriptingDefineSymbols(target, defines.ToArray());
        }
    }
}
