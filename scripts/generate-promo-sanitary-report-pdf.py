from __future__ import annotations

import json
import math
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "output" / "pdf" / "promo-sanitary-report-data.json"
OUT = ROOT / "output" / "pdf" / "promo-sanitary-report-uk.pdf"

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "ReportArial"
BOLD = "ReportArialBold"
pdfmetrics.registerFont(TTFont(REG, FONT_REGULAR))
pdfmetrics.registerFont(TTFont(BOLD, FONT_BOLD))

W, H = landscape(A4)
M = 34

INK = colors.HexColor("#203047")
MUTED = colors.HexColor("#718094")
LINE = colors.HexColor("#DFD6CC")
PAPER = colors.HexColor("#FFF8F0")
CREAM = colors.HexColor("#F6E8D8")
CLAY = colors.HexColor("#B9633E")
TERRACOTTA = colors.HexColor("#D98555")
COPPER = colors.HexColor("#A95535")
TEAL = colors.HexColor("#257C7A")
GREEN = colors.HexColor("#4F8B57")
RED = colors.HexColor("#C44536")
AMBER = colors.HexColor("#D59A2F")
WHITE = colors.white


def money(value: float | int | None) -> str:
    value = 0 if value is None else value
    return f"{round(value):,}".replace(",", " ") + " грн"


def num(value: float | int | None, digits: int = 0) -> str:
    if value is None:
        return "н/д"
    if digits:
        return f"{value:,.{digits}f}".replace(",", " ").replace(".", ",")
    return f"{round(value):,}".replace(",", " ")


def pct(value: float | int | None, digits: int = 1) -> str:
    if value is None:
        return "н/д"
    return f"{value:.{digits}f}".replace(".", ",") + "%"


def date_ua(value: str) -> str:
    y, m, d = value.split("-")
    return f"{d}.{m}.{y}"


def set_font(c: canvas.Canvas, font: str, size: int, color=INK):
    c.setFont(font, size)
    c.setFillColor(color)


def t(c: canvas.Canvas, x: float, y: float, text: str, size=10, color=INK, font=REG):
    set_font(c, font, size, color)
    c.drawString(x, y, text)


def rt(c: canvas.Canvas, x: float, y: float, text: str, size=10, color=INK, font=REG):
    set_font(c, font, size, color)
    c.drawRightString(x, y, text)


def split_text(text: str, font: str, size: int, width: float, max_lines: int = 2) -> list[str]:
    words = str(text).split()
    lines: list[str] = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        if pdfmetrics.stringWidth(test, font, size) <= width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
        if len(lines) >= max_lines:
            break
    if len(lines) < max_lines and current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    original = " ".join(words)
    if lines and " ".join(lines) != original:
        while lines[-1] and pdfmetrics.stringWidth(lines[-1] + "...", font, size) > width:
            lines[-1] = lines[-1][:-1]
        lines[-1] = lines[-1].rstrip(" .,;:") + "..."
    return lines or [""]


def rounded(c: canvas.Canvas, x: float, y: float, w: float, h: float, fill=WHITE, stroke=LINE, r=10):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.roundRect(x, y, w, h, r, fill=1, stroke=1)


def cover_bg(c: canvas.Canvas):
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(CREAM)
    c.circle(96, H - 80, 210, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#EED1B7"))
    c.circle(W - 80, 30, 180, fill=1, stroke=0)
    c.setFillColor(TEAL)
    c.roundRect(W - 182, 0, 182, H, 0, fill=1, stroke=0)
    c.setStrokeColor(colors.HexColor("#F0B07E"))
    c.setLineWidth(9)
    c.arc(W - 150, H - 168, W - 36, H - 54, 210, 250)
    c.setStrokeColor(WHITE)
    c.setLineWidth(4)
    c.line(W - 112, H - 93, W - 72, H - 93)
    c.line(W - 92, H - 113, W - 92, H - 73)
    c.setStrokeColor(colors.HexColor("#C9EFE8"))
    c.setLineWidth(2)
    for i in range(5):
        c.line(W - 134 + i * 20, H - 137, W - 148 + i * 25, H - 190)


def header(c: canvas.Canvas, title: str, subtitle: str, page: int):
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(CLAY)
    c.rect(0, H - 76, W, 76, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#E7B48E"))
    c.rect(0, H - 80, W, 4, fill=1, stroke=0)
    t(c, M, H - 34, title, 22, WHITE, BOLD)
    t(c, M, H - 56, subtitle, 9, colors.HexColor("#FFE7D5"), REG)
    rt(c, W - M, 22, str(page), 9, MUTED, REG)


def kpi(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str, value: str, note: str, color):
    rounded(c, x, y, w, h, WHITE, LINE, 12)
    c.setFillColor(color)
    c.roundRect(x, y, 6, h, 3, fill=1, stroke=0)
    t(c, x + 18, y + h - 24, label.upper(), 8, MUTED, BOLD)
    t(c, x + 18, y + h - 55, value, 21, INK, BOLD)
    for i, line in enumerate(split_text(note, REG, 8, w - 28, 2)):
        t(c, x + 18, y + 16 - i * 11, line, 8, MUTED, REG)


def progress(c: canvas.Canvas, x: float, y: float, w: float, pct_value: float, color=TEAL):
    c.setFillColor(colors.HexColor("#ECDDCF"))
    c.roundRect(x, y, w, 13, 6.5, fill=1, stroke=0)
    c.setFillColor(color)
    c.roundRect(x, y, max(4, min(w, w * pct_value / 100)), 13, 6.5, fill=1, stroke=0)


def table(c: canvas.Canvas, x: float, y: float, widths: list[float], rows: list[list[str]], row_h=28, font_size=8, header_fill=INK):
    c.setFillColor(header_fill)
    c.roundRect(x, y, sum(widths), row_h, 8, fill=1, stroke=0)
    cx = x
    for i, cell in enumerate(rows[0]):
        t(c, cx + 7, y + 10, cell, font_size, WHITE, BOLD)
        cx += widths[i]
    y -= row_h
    for r, row in enumerate(rows[1:]):
        c.setFillColor(WHITE if r % 2 == 0 else colors.HexColor("#FFFDF9"))
        c.setStrokeColor(LINE)
        c.rect(x, y, sum(widths), row_h, fill=1, stroke=1)
        cx = x
        for i, cell in enumerate(row):
            max_lines = 2 if widths[i] > 165 else 1
            lines = split_text(cell, BOLD if i == 0 else REG, font_size, widths[i] - 12, max_lines)
            for j, line in enumerate(lines):
                t(c, cx + 7, y + row_h - 13 - j * 9, line, font_size, INK if i == 0 else MUTED, BOLD if i == 0 else REG)
            cx += widths[i]
        y -= row_h


def slide_cover(c: canvas.Canvas, d: dict):
    cover_bg(c)
    meta = d["meta"]
    t(c, M, H - 64, "AGROMAT", 16, CLAY, BOLD)
    t(c, M, H - 88, "Щоденний промо-звіт", 12, MUTED, REG)
    t(c, M, H - 158, f"Акція «{meta['promoName']}»", 42, INK, BOLD)
    t(c, M, H - 198, f"Звіт за {date_ua(meta['reportDate'])} · старт {date_ua(meta['startDate'])}", 16, COPPER, BOLD)
    t(c, M, H - 232, f"IDD у сегменті: {meta['requestedCodes']} · каталог: {meta['foundProducts']} · продажі: {meta.get('foundInSales', 'н/д')}", 12, MUTED, REG)
    rounded(c, M, 70, 520, 82, WHITE, LINE, 14)
    t(c, M + 22, 122, "Фокус звіту", 13, INK, BOLD)
    t(c, M + 22, 98, "Продажі, контент, конкурентна ціна та переоцінка по товарах акції.", 11, MUTED, REG)
    t(c, M + 22, 80, "Дані реальні; тестовим є тільки візуальний шаблон і структура подачі.", 9, CLAY, BOLD)


def slide_sales(c: canvas.Canvas, d: dict):
    s = d["sales"]
    header(c, "1. Продажі акції", "Оформлення, відвантаження та виконання плану", 2)
    kpi(c, M, H - 174, 174, 86, "Оформили вчора", money(s["yesterdayRevenue"]), f"{s['yesterdayDocs']} документів", TERRACOTTA)
    kpi(c, M + 190, H - 174, 174, 86, "Оформлено з початку", money(s["sinceCreatedRevenue"]), f"{s['sinceCreatedDocs']} документів", CLAY)
    kpi(c, M + 380, H - 174, 174, 86, "Повністю відвантажено", money(s["sinceShippedRevenue"]), f"{s['sinceShippedDocs']} документів", GREEN)
    kpi(c, M + 570, H - 174, 190, 86, "Виконання плану", pct(s["completionPct"]), f"{money(s['planRevenue'])} з плану", TEAL)
    t(c, M, H - 218, "Прогрес до плану акції", 13, INK, BOLD)
    progress(c, M, H - 246, 610, s["completionPct"], TEAL)
    rt(c, M + 610, H - 268, f"{money(s['planRevenue'])} / {money(s['plan'])}", 10, MUTED, REG)
    rows = [["Показник", "Сума", "Документи", "Коментар"],
            ["Оформили вчора", money(s["yesterdayRevenue"]), str(s["yesterdayDocs"]), "за звітний день"],
            ["Оформлено з початку акції", money(s["sinceCreatedRevenue"]), str(s["sinceCreatedDocs"]), "сума документів"],
            ["Виконання плану", money(s["planRevenue"]), str(s["sanitaryPlan"]["goods"] if s.get("sanitaryPlan") else ""), f"{pct(s['completionPct'])} від плану"],
            ["Повністю відвантажено з початку", money(s["sinceShippedRevenue"]), str(s["sinceShippedDocs"]), "тільки повністю відвантажені"]]
    table(c, M, H - 314, [220, 150, 100, 260], rows, 29, 9, COPPER)


def slide_top(c: canvas.Canvas, d: dict):
    header(c, "2. Топ товарів за продажами", "Топ-10 IDD за оформленою сумою з початку акції", 3)
    rows = [["#", "IDD", "Назва", "Оформлено, грн", "Шт./рядків"]]
    for i, item in enumerate(d["sales"]["topProducts"], 1):
        rows.append([str(i), str(item["code"]), item["name"], money(item["revenue"]), str(item["qty"])])
    table(c, M, H - 124, [34, 72, 430, 132, 74], rows, 36, 8, INK)
    t(c, M, 54, "Примітка: кількість показана як товарні рядки у S3-файлі, бо окремого поля кількості одиниць у джерелі немає.", 9, MUTED, REG)


def slide_content(c: canvas.Canvas, d: dict):
    co = d["content"]
    header(c, "3. Контент і статуси", "Якість карток та доступність товарів у промо-сегменті", 4)
    kpi(c, M, H - 162, 154, 78, "Товарів в акції", num(co["total"]), "знайдено по IDD", TERRACOTTA)
    kpi(c, M + 170, H - 162, 154, 78, "В наявності", num(co["inStock"]), f"{pct(co['inStock']/co['total']*100 if co['total'] else 0)} сегменту", GREEN)
    kpi(c, M + 340, H - 162, 154, 78, "Інші статуси", num(co["others"]), "залишаємо total", AMBER)
    kpi(c, M + 510, H - 162, 154, 78, "Без відгуків", num(co["noReviews"]), "потребує уваги", RED)
    kpi(c, M + 680, H - 162, 108, 78, "<5 атр.", num(co["lowAttrs"]), "атрибути", CLAY)
    rows = [["Категорія", "Всього", "В наяв.", "Інші", "<2 фото", "<5 атр.", "Без відг.", "Реф. після фото"]]
    for item in co["categories"][:10]:
        rows.append([item["category"], str(item["total"]), str(item["inStock"]), str(item["others"]),
                     str(item["lowPhotos"]), str(item["lowAttrs"]), str(item["noReviews"]), "потр. правило"])
    table(c, M, H - 214, [230, 62, 62, 58, 58, 58, 64, 104], rows, 28, 7, COPPER)
    t(c, M, 52, "Колонка референсу додана, але для точного підрахунку треба правило визначення типу фото: зараз у даних є main/sort/url.", 8, MUTED, REG)


def slide_competitors(c: canvas.Canvas, d: dict):
    header(c, "4. Аналіз конкурентів", "Покриття парсингу та цінові порушення по товарах акції", 5)
    rows = [["Конкурент", "Парситься", "З ціною", "Порушення", "Без поруш.", "Ми дешевші", "Сер. нижче"]]
    for cpt in d["competitors"]:
        rows.append([cpt["name"], str(cpt["targetCount"]), str(cpt["parsedCount"]), str(cpt["violations"]),
                     str(cpt["noViolations"]), str(cpt["ourCheaper"]), pct(cpt["avgOurCheaperPct"])])
    table(c, M, H - 128, [150, 92, 82, 92, 92, 90, 90], rows, 34, 9, INK)
    total_targets = sum(x["targetCount"] for x in d["competitors"])
    total_parsed = sum(x["parsedCount"] for x in d["competitors"])
    total_violations = sum(x["violations"] for x in d["competitors"])
    kpi(c, M, 78, 184, 76, "Покриття", f"{total_parsed}/{total_targets}", "товар-конкурентів з ціною", TEAL)
    kpi(c, M + 202, 78, 184, 76, "Порушення", str(total_violations), "конкурент нижче нас >5%", RED)
    kpi(c, M + 404, 78, 184, 76, "Без порушень", str(sum(x["noViolations"] for x in d["competitors"])), "у межах правила", GREEN)


def slide_prices(c: canvas.Canvas, d: dict):
    header(c, "5. Переоцінка: Agromat і конкуренти", "Що змінилося у цінах між останніми знімками", 6)
    ag = d["agromatPrices"]
    kpi(c, M, H - 160, 174, 76, "Agromat: переоцінено", str(ag["repricedCount"]), f"без змін {ag['unchangedCount']}", TERRACOTTA)
    kpi(c, M + 190, H - 160, 140, 76, "Ціна зросла", str(ag["repricedUpCount"]), "Agromat", GREEN)
    kpi(c, M + 346, H - 160, 140, 76, "Ціна знизилась", str(ag["repricedDownCount"]), "Agromat", RED)
    kpi(c, M + 502, H - 160, 170, 76, "Без змін", str(ag["unchangedCount"]), "товари акції", TEAL)
    rows = [["Конкурент", "Дата", "Переоцінено", "Зросла", "Знизилась", "Без змін"]]
    for cpt in d["competitors"]:
        pc = cpt["priceChanges"]
        date_label = cpt["latestDate"] or "н/д"
        if cpt["previousDate"]:
            date_label = f"{cpt['previousDate']} → {cpt['latestDate']}"
        rows.append([cpt["name"], date_label, str(pc["changed"]), str(pc["up"]), str(pc["down"]), str(pc["same"])])
    table(c, M, H - 214, [150, 170, 110, 90, 100, 100], rows, 32, 8, COPPER)


def slide_notes(c: canvas.Canvas, d: dict):
    header(c, "6. Дані та наступні уточнення", "Що вже рахується і що треба формалізувати", 7)
    rows = [["Зона", "Статус"],
            ["Продажі", "реальні дані S3; топ-10 по товарних рядках акції"],
            ["Контент", "реальні дані каталогу: статуси, фото, атрибути, відгуки"],
            ["Конкуренти", "реальні останні знімки Supabase по товарах, які парсяться"],
            ["Референс у фото", "потрібне правило або маркер типу фото у даних"],
            ["Автоматизація", "підключимо після погодження структури та дизайну"]]
    table(c, M, H - 132, [180, 500], rows, 38, 10, TEAL)
    for i, note in enumerate(d["meta"]["notes"]):
        t(c, M, 96 - i * 18, f"• {note}", 9, MUTED, REG)


def main() -> None:
    with DATA.open("r", encoding="utf-8") as f:
        d = json.load(f)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=landscape(A4))
    slides = [slide_cover, slide_sales, slide_top, slide_content, slide_competitors, slide_prices, slide_notes]
    for slide in slides:
        slide(c, d)
        c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    main()
