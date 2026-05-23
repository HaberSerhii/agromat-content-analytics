// Tab 1 — embeds the legacy Agromat_Parcer Flask app served on port 8080.
// When/if we move to a single domain with SSL, this URL will switch to a path
// like /parser/ via nginx proxy.
const PARCER_URL = process.env.NEXT_PUBLIC_PARCER_URL || "http://91.239.233.125:8080/";

export default function CompetitorsPage() {
  return (
    <div
      className="rounded-2xl overflow-hidden border"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-card)",
        boxShadow: "var(--shadow-sm)",
        // Fill remaining viewport height: subtract approximate header height
        height: "calc(100vh - 90px)",
      }}
    >
      <iframe
        src={PARCER_URL}
        title="Аналіз цін конкурентів"
        className="w-full h-full block"
        style={{ border: 0 }}
        // sandbox is intentionally omitted — we control the embedded origin
        // and the app uses cookies/POST forms that sandbox blocks
      />
    </div>
  );
}
