using System.Collections.Generic;
using UnityEngine;

namespace AVN.QA
{
    /// <summary>
    /// Optional settings asset. Create it with Assets > Create > AVN > QA Settings and keep it
    /// at Resources/AVNQASettings. Without it the defaults below apply.
    /// </summary>
    [CreateAssetMenu(fileName = "AVNQASettings", menuName = "AVN/QA Settings")]
    public sealed class AVNQASettings : ScriptableObject
    {
        public const int DefaultPort = 7421;
        const string ResourceName = "AVNQASettings";

        [Tooltip("Loopback TCP port the bridge listens on. PlayLens reaches it through 'adb forward'.")]
        public int port = DefaultPort;

        [Tooltip("Start the bridge automatically when the game starts (QA builds only).")]
        public bool autoStart = true;

        [Tooltip("Google advertising IDs of the QA phones. In QA builds the plugin hooks sample passes these to MAX test mode so runs never serve or click real ads. Phone: Settings > Google > Ads.")]
        public List<string> testDeviceAdvertisingIds = new List<string>();

        static AVNQASettings _loaded;
        static bool _tried;

        public static AVNQASettings Current
        {
            get
            {
                if (!_tried)
                {
                    _tried = true;
                    _loaded = Resources.Load<AVNQASettings>(ResourceName);
                }
                return _loaded;
            }
        }

        public static int Port => Current != null && Current.port > 0 ? Current.port : DefaultPort;
        public static bool AutoStart => Current == null || Current.autoStart;
        public static IReadOnlyList<string> TestDeviceIds => Current != null ? Current.testDeviceAdvertisingIds : new List<string>();
    }
}
