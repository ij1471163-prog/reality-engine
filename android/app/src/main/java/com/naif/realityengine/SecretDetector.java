package com.naif.realityengine;

import java.util.*;
import java.util.regex.*;

public class SecretDetector {

    public static class Secret {
        public String title, fix, cwe;
        public int    line;
        public String severity;
        public Secret(String title, String fix, String cwe, int line, String sev) {
            this.title = title; this.fix = fix;
            this.cwe = cwe; this.line = line; this.severity = sev;
        }
    }

    private static final Object[][] PATTERNS = {
        {"AWS Access Key",        "AKIA[0-9A-Z]{16}",                                          "CRITICAL", "CWE-798", "// استخدم AWS IAM Roles"},
        {"GitHub PAT",            "ghp_[A-Za-z0-9]{36}",                                       "CRITICAL", "CWE-798", "// أضف للـ .env"},
        {"GitHub Fine-grained",   "github_pat_[A-Za-z0-9_]{82}",                               "CRITICAL", "CWE-798", "// لا ترفع tokens في الكود"},
        {"Google API Key",        "AIza[0-9A-Za-z\\-_]{35}",                                   "CRITICAL", "CWE-798", "// قيّد المفتاح في Google Console"},
        {"Stripe Secret Key",     "sk_live_[A-Za-z0-9]{24,}",                                  "CRITICAL", "CWE-798", "// استخدم env vars"},
        {"Anthropic API Key",     "sk-ant-[A-Za-z0-9\\-_]{40,}",                               "CRITICAL", "CWE-798", "// استخدم process.env.ANTHROPIC_API_KEY"},
        {"OpenAI API Key",        "sk-[A-Za-z0-9]{48}",                                        "CRITICAL", "CWE-798", "// استخدم process.env.OPENAI_API_KEY"},
        {"RSA Private Key",       "-----BEGIN RSA PRIVATE KEY-----",                            "CRITICAL", "CWE-321", "// لا ترفع private keys"},
        {"SSH Private Key",       "-----BEGIN OPENSSH PRIVATE KEY-----",                        "CRITICAL", "CWE-321", "// أضف لـ .gitignore"},
        {"Slack Bot Token",       "xoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24}",               "CRITICAL", "CWE-798", "// استخدم env vars"},
        {"Database URL",          "(?:mongodb|mysql|postgres)://[^:]+:[^@]+@",                  "CRITICAL", "CWE-798", "// استخدم DATABASE_URL في env vars"},
        {"JWT Token",             "eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",  "HIGH",     "CWE-798", "// لا تضع JWT في الكود"},
        {"Hardcoded Password",    "(?i)(?:password|passwd)\\s*[:=]\\s*['\"][^'\"]{8,}['\"]",   "HIGH",     "CWE-259", "// استخدم environment variables"},
        {"Hardcoded API Key",     "(?i)api[_-]?key\\s*[:=]\\s*['\"][A-Za-z0-9_\\-]{16,}['\"]","HIGH",     "CWE-798", "// استخدم env vars"},
    };

    public static List<Secret> scan(String code, String fileName) {
        List<Secret> secrets = new ArrayList<>();
        String[] lines = code.split("\n");

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String t    = line.trim();
            int    ln   = i + 1;

            if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*")) continue;
            if (t.toLowerCase().contains("example") || t.toLowerCase().contains("placeholder")) continue;

            for (Object[] pat : PATTERNS) {
                String name = (String) pat[0];
                String regex = (String) pat[1];
                String sev   = (String) pat[2];
                String cwe   = (String) pat[3];
                String fix   = (String) pat[4];

                try {
                    if (Pattern.compile(regex).matcher(line).find()) {
                        secrets.add(new Secret(
                            "🔐 " + name + " مكشوف في الكود",
                            fix, cwe, ln, sev
                        ));
                    }
                } catch (Exception e) { /* skip invalid pattern */ }
            }
        }
        return secrets;
    }
}
