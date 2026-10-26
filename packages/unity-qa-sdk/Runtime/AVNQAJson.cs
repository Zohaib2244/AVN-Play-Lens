#if AVN_QA
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace AVN.QA
{
    /// <summary>
    /// Minimal JSON reader/writer for the bridge protocol. Objects become
    /// Dictionary&lt;string, object&gt;, arrays List&lt;object&gt;, numbers double
    /// (or long when integral), plus string, bool and null.
    /// </summary>
    internal static class AVNQAJson
    {
        public static string Serialize(object value)
        {
            var sb = new StringBuilder(256);
            Write(sb, value, 0);
            return sb.ToString();
        }

        public static object Parse(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            int i = 0;
            var v = ReadValue(json, ref i);
            SkipWs(json, ref i);
            if (i != json.Length) throw new FormatException("Trailing characters at " + i);
            return v;
        }

        public static Dictionary<string, object> ParseObject(string json)
        {
            return Parse(json) as Dictionary<string, object>;
        }

        // ── writer ─────────────────────────────────────────────────────────

        static void Write(StringBuilder sb, object value, int depth)
        {
            if (depth > 32) { sb.Append("null"); return; }
            switch (value)
            {
                case null: sb.Append("null"); break;
                case string s: WriteString(sb, s); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case int n: sb.Append(n.ToString(CultureInfo.InvariantCulture)); break;
                case long n: sb.Append(n.ToString(CultureInfo.InvariantCulture)); break;
                case float f: WriteNumber(sb, f); break;
                case double d: WriteNumber(sb, d); break;
                case decimal m: sb.Append(m.ToString(CultureInfo.InvariantCulture)); break;
                case Enum e: WriteString(sb, e.ToString()); break;
                case IDictionary dict:
                    sb.Append('{');
                    bool first = true;
                    foreach (DictionaryEntry kv in dict)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteString(sb, Convert.ToString(kv.Key, CultureInfo.InvariantCulture));
                        sb.Append(':');
                        Write(sb, kv.Value, depth + 1);
                    }
                    sb.Append('}');
                    break;
                case IEnumerable list:
                    sb.Append('[');
                    bool firstItem = true;
                    foreach (var item in list)
                    {
                        if (!firstItem) sb.Append(',');
                        firstItem = false;
                        Write(sb, item, depth + 1);
                    }
                    sb.Append(']');
                    break;
                default:
                    if (value is IConvertible c && IsNumeric(c))
                        sb.Append(Convert.ToDouble(value, CultureInfo.InvariantCulture).ToString("R", CultureInfo.InvariantCulture));
                    else
                        WriteString(sb, value.ToString());
                    break;
            }
        }

        static bool IsNumeric(IConvertible c)
        {
            switch (c.GetTypeCode())
            {
                case TypeCode.Byte: case TypeCode.SByte: case TypeCode.Int16: case TypeCode.UInt16:
                case TypeCode.UInt32: case TypeCode.UInt64: return true;
                default: return false;
            }
        }

        static void WriteNumber(StringBuilder sb, double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
            sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char ch in s)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                        else sb.Append(ch);
                        break;
                }
            }
            sb.Append('"');
        }

        // ── reader ─────────────────────────────────────────────────────────

        static void SkipWs(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
        }

        static object ReadValue(string s, ref int i)
        {
            SkipWs(s, ref i);
            if (i >= s.Length) throw new FormatException("Unexpected end of JSON");
            char c = s[i];
            if (c == '{') return ReadObject(s, ref i);
            if (c == '[') return ReadArray(s, ref i);
            if (c == '"') return ReadString(s, ref i);
            if (c == 't') { Expect(s, ref i, "true"); return true; }
            if (c == 'f') { Expect(s, ref i, "false"); return false; }
            if (c == 'n') { Expect(s, ref i, "null"); return null; }
            return ReadNumber(s, ref i);
        }

        static void Expect(string s, ref int i, string word)
        {
            if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0) throw new FormatException("Expected " + word + " at " + i);
            i += word.Length;
        }

        static Dictionary<string, object> ReadObject(string s, ref int i)
        {
            var d = new Dictionary<string, object>();
            i++; // {
            SkipWs(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return d; }
            while (true)
            {
                SkipWs(s, ref i);
                if (i >= s.Length || s[i] != '"') throw new FormatException("Expected key at " + i);
                string key = ReadString(s, ref i);
                SkipWs(s, ref i);
                if (i >= s.Length || s[i] != ':') throw new FormatException("Expected ':' at " + i);
                i++;
                d[key] = ReadValue(s, ref i);
                SkipWs(s, ref i);
                if (i >= s.Length) throw new FormatException("Unterminated object");
                if (s[i] == ',') { i++; continue; }
                if (s[i] == '}') { i++; return d; }
                throw new FormatException("Expected ',' or '}' at " + i);
            }
        }

        static List<object> ReadArray(string s, ref int i)
        {
            var list = new List<object>();
            i++; // [
            SkipWs(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return list; }
            while (true)
            {
                list.Add(ReadValue(s, ref i));
                SkipWs(s, ref i);
                if (i >= s.Length) throw new FormatException("Unterminated array");
                if (s[i] == ',') { i++; continue; }
                if (s[i] == ']') { i++; return list; }
                throw new FormatException("Expected ',' or ']' at " + i);
            }
        }

        static string ReadString(string s, ref int i)
        {
            var sb = new StringBuilder();
            i++; // opening quote
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= s.Length) break;
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        if (i + 4 > s.Length) throw new FormatException("Bad unicode escape");
                        sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16));
                        i += 4;
                        break;
                    default: throw new FormatException("Bad escape \\" + e);
                }
            }
            throw new FormatException("Unterminated string");
        }

        static object ReadNumber(string s, ref int i)
        {
            int start = i;
            if (i < s.Length && (s[i] == '-' || s[i] == '+')) i++;
            bool isFloat = false;
            while (i < s.Length)
            {
                char c = s[i];
                if (char.IsDigit(c)) { i++; continue; }
                if (c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+') { isFloat = true; i++; continue; }
                break;
            }
            string tok = s.Substring(start, i - start);
            if (tok.Length == 0) throw new FormatException("Unexpected character at " + start);
            if (!isFloat && long.TryParse(tok, NumberStyles.Integer, CultureInfo.InvariantCulture, out long l)) return l;
            if (double.TryParse(tok, NumberStyles.Float, CultureInfo.InvariantCulture, out double d)) return d;
            throw new FormatException("Bad number '" + tok + "'");
        }
    }
}
#endif
