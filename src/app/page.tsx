import { Card } from "@/components/ui";

export default function CompetitorsPage() {
  return (
    <Card>
      <div className="text-center py-16">
        <div className="text-2xl font-bold mb-2" style={{ color: "var(--text)" }}>
          Аналіз цін конкурентів
        </div>
        <div className="text-sm" style={{ color: "var(--text-dim)" }}>
          Сторінка в розробці. Тут буде моніторинг цін на товари в конкурентів.
        </div>
      </div>
    </Card>
  );
}
