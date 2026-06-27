from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "promo-report-demo-dni-ispanii.pdf"
FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

W, H = landscape(A4)
M = 36


def register_fonts() -> tuple[str, str]:
    regular = "ReportRegular"
    bold = "ReportBold"
    pdfmetrics.registerFont(TTFont(regular, FONT_REGULAR))
    pdfmetrics.registerFont(TTFont(bold, FONT_BOLD))
    return regular, bold


REGULAR, BOLD = register_fonts()


PALETTE = {
    "ink": colors.HexColor("#172033"),
    "muted": colors.HexColor("#647086"),
    "line": colors.HexColor("#D8DEE8"),
    "blue": colors.HexColor("#118DFF"),
    "green": colors.HexColor("#15A46D"),
    "red": colors.HexColor("#D94841"),
    "amber": colors.HexColor("#E39924"),
    "violet": colors.HexColor("#6B5DD3"),
    "bg": colors.HexColor("#F5F7FA"),
    "white": colors.white,
    "soft_blue": colors.HexColor("#EAF4FF"),
    "soft_green": colors.HexColor("#EAF8F2"),
    "soft_red": colors.HexColor("#FDEDEC"),
    "soft_amber": colors.HexColor("#FFF4E1"),
}


def yesterday() -> date:
    return date.today() - timedelta(days=1)


def money(value: int) -> str:
    return f"{value:,}".replace(",", " ") + " грн"


def text(c: canvas.Canvas, x: float, y: float, value: str, size: int = 12, color=PALETTE["ink"], font=REGULAR):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawString(x, y, value)


def right_text(c: canvas.Canvas, x: float, y: float, value: str, size: int = 12, color=PALETTE["ink"], font=REGULAR):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawRightString(x, y, value)


def pill(c: canvas.Canvas, x: float, y: float, w: float, label: str, bg, fg=PALETTE["ink"]):
    c.setFillColor(bg)
    c.roundRect(x, y, w, 22, 10, fill=1, stroke=0)
    text(c, x + 10, y + 6, label, 9, fg, BOLD)


def card(c: canvas.Canvas, x: float, y: float, w: float, h: float, title: str, value: str, hint: str, accent):
    c.setFillColor(PALETTE["white"])
    c.setStrokeColor(PALETTE["line"])
    c.roundRect(x, y, w, h, 8, fill=1, stroke=1)
    c.setFillColor(accent)
    c.roundRect(x, y, 5, h, 2, fill=1, stroke=0)
    text(c, x + 18, y + h - 22, title.upper(), 8, PALETTE["muted"], BOLD)
    text(c, x + 18, y + h - 52, value, 22, PALETTE["ink"], BOLD)
    text(c, x + 18, y + 16, hint, 9, PALETTE["muted"], REGULAR)


def bar(c: canvas.Canvas, x: float, y: float, w: float, pct: float, color):
    c.setFillColor(colors.HexColor("#E7EBF1"))
    c.roundRect(x, y, w, 8, 4, fill=1, stroke=0)
    c.setFillColor(color)
    c.roundRect(x, y, max(3, w * pct / 100), 8, 4, fill=1, stroke=0)


def page_header(c: canvas.Canvas, title: str, subtitle: str, page: int):
    c.setFillColor(PALETTE["bg"])
    c.rect(0, 0, W, H, fill=1, stroke=0)
    text(c, M, H - 42, title, 20, PALETTE["ink"], BOLD)
    text(c, M, H - 62, subtitle, 10, PALETTE["muted"], REGULAR)
    pill(c, W - 188, H - 52, 152, "Демо-шаблон · тестовые данные", PALETTE["soft_amber"], PALETTE["amber"])
    right_text(c, W - M, 24, f"{page}", 9, PALETTE["muted"], REGULAR)


def draw_table(c: canvas.Canvas, x: float, y: float, widths: list[float], rows: list[list[str]], header_bg=PALETTE["ink"]):
    row_h = 26
    c.setFillColor(header_bg)
    c.roundRect(x, y, sum(widths), row_h, 6, fill=1, stroke=0)
    cx = x
    for i, cell in enumerate(rows[0]):
        text(c, cx + 8, y + 9, cell, 8, PALETTE["white"], BOLD)
        cx += widths[i]
    y -= row_h
    for r, row in enumerate(rows[1:]):
        c.setFillColor(PALETTE["white"] if r % 2 == 0 else colors.HexColor("#FBFCFE"))
        c.setStrokeColor(PALETTE["line"])
        c.rect(x, y, sum(widths), row_h, fill=1, stroke=1)
        cx = x
        for i, cell in enumerate(row):
            text(c, cx + 8, y + 9, cell, 8, PALETTE["ink"] if i == 0 else PALETTE["muted"], BOLD if i == 0 else REGULAR)
            cx += widths[i]
        y -= row_h


def slide_cover(c: canvas.Canvas, report_date: date):
    c.setFillColor(PALETTE["white"])
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(PALETTE["blue"])
    c.rect(0, 0, W * 0.36, H, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#0B67BA"))
    c.circle(130, 360, 150, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#15A46D"))
    c.circle(255, 145, 92, fill=1, stroke=0)
    text(c, M, H - 72, "AGROMAT", 18, PALETTE["white"], BOLD)
    text(c, M, H - 104, "Promo Analytics", 12, colors.HexColor("#D9ECFF"), REGULAR)
    text(c, W * 0.42, H - 124, "Дни Испании", 38, PALETTE["ink"], BOLD)
    text(c, W * 0.42, H - 158, "Ежедневный отчет по акции", 20, PALETTE["muted"], REGULAR)
    text(c, W * 0.42, H - 202, f"Период: {report_date.strftime('%d.%m.%Y')} · старт акции: 15.06.2026", 13, PALETTE["ink"], BOLD)
    text(c, W * 0.42, H - 232, "Сегмент IDD: будет подставляться из списка акции", 11, PALETTE["muted"], REGULAR)
    text(c, W * 0.42, 100, "В этом демо числа примерные - макет показывает будущую структуру,", 10, PALETTE["muted"], REGULAR)
    text(c, W * 0.42, 80, "визуальный ритм и доставку отчета в Telegram.", 10, PALETTE["muted"], REGULAR)


def slide_sales(c: canvas.Canvas):
    page_header(c, "1. Продажи", "Оформления, отгрузки и накопительный итог акции", 2)
    y = H - 156
    card(c, M, y, 176, 88, "Оформлено вчера", money(286_400), "42 документа · 118 товаров", PALETTE["blue"])
    card(c, M + 194, y, 176, 88, "Полностью отгружено", money(198_750), "29 документов · 84 товара", PALETTE["green"])
    card(c, M + 388, y, 176, 88, "С начала акции", money(2_734_100), "15.06 - вчера · 438 товаров", PALETTE["violet"])
    card(c, M + 582, y, 176, 88, "Возвраты/отмены", money(18_900), "3 отмены · 1 возврат", PALETTE["red"])
    rows = [
        ["Показатель", "Вчера", "С начала акции", "Комментарий"],
        ["Оформлено", money(286_400), money(2_734_100), "+8% к среднему дню"],
        ["Повністю відвантажено", money(198_750), money(1_982_300), "73% от оформлений"],
        ["Товаров в заказах", "118 шт", "1 246 шт", "без дублей: 384 IDD"],
        ["Средний чек", money(6_819), money(6_242), "ровная динамика"],
    ]
    draw_table(c, M, y - 54, [190, 140, 150, 260], rows)


def slide_content(c: canvas.Canvas):
    page_header(c, "2. Контент и статусы", "Покрытие товаров акции по категориям", 3)
    y = H - 144
    card(c, M, y, 176, 82, "Товаров в акции", "312", "IDD в сегменте", PALETTE["blue"])
    card(c, M + 194, y, 176, 82, "В наличии", "241", "77.2% сегмента", PALETTE["green"])
    card(c, M + 388, y, 176, 82, "Остальные статусы", "71", "нет, ожидается, архив", PALETTE["amber"])
    card(c, M + 582, y, 176, 82, "Недозаполнены", "96", "есть хотя бы один риск", PALETTE["red"])
    rows = [
        ["Категория", "Всего", "В наличии", "Остальные", "<2 фото", "<5 атриб.", "Без отзывов"],
        ["Плитка настенная", "96", "82", "14", "18", "27", "64"],
        ["Плитка напольная", "74", "59", "15", "12", "21", "43"],
        ["Керамогранит", "88", "68", "20", "9", "25", "51"],
        ["Декоры", "54", "32", "22", "7", "16", "29"],
    ]
    draw_table(c, M, y - 50, [174, 78, 92, 94, 86, 90, 104], rows)
    text(c, M, 58, "Идея для финальной версии: красным подсвечивать категории, где недозаполнение влияет на товары в наличии.", 10, PALETTE["muted"], REGULAR)


def slide_prices(c: canvas.Canvas):
    page_header(c, "3. Изменения цен", "Что поменялось за последний день по товарам акции", 4)
    y = H - 150
    card(c, M, y, 176, 88, "Переоценено", "37 товаров", "11.9% сегмента", PALETTE["violet"])
    card(c, M + 194, y, 176, 88, "Цена выросла", "21", "среднее изменение +4.2%", PALETTE["green"])
    card(c, M + 388, y, 176, 88, "Цена снизилась", "16", "среднее изменение -3.1%", PALETTE["red"])
    card(c, M + 582, y, 176, 88, "Без изменений", "275", "контрольная группа", PALETTE["blue"])
    text(c, M, y - 38, "Распределение переоценки по категориям", 14, PALETTE["ink"], BOLD)
    items = [
        ("Плитка настенная", 16, 10, 6, 73),
        ("Плитка напольная", 9, 4, 5, 41),
        ("Керамогранит", 8, 5, 3, 36),
        ("Декоры", 4, 2, 2, 18),
    ]
    yy = y - 74
    for name, total, up, down, pct in items:
        text(c, M, yy + 1, name, 10, PALETTE["ink"], BOLD)
        bar(c, M + 170, yy, 310, pct, PALETTE["violet"])
        text(c, M + 500, yy + 1, f"{total} всего · вверх {up} · вниз {down}", 10, PALETTE["muted"], REGULAR)
        yy -= 36


def slide_competitors(c: canvas.Canvas):
    page_header(c, "4. Конкуренты", "Нарушения и позиция нашей цены относительно рынка", 5)
    y = H - 144
    card(c, M, y, 176, 82, "Парсятся", "184 товара", "из 312 IDD", PALETTE["blue"])
    card(c, M + 194, y, 176, 82, "Нарушения", "22", "конкурент дешевле >5%", PALETTE["red"])
    card(c, M + 388, y, 176, 82, "Без нарушений", "162", "мы ниже или в коридоре", PALETTE["green"])
    card(c, M + 582, y, 176, 82, "Мы ниже рынка", "на 7.8%", "среднее по безопасным", PALETTE["violet"])
    rows = [
        ["Конкурент", "Парсится", "Нарушений", "Без наруш.", "Наша цена ниже"],
        ["Венкон", "58", "7", "51", "6.4%"],
        ["Теплорадость", "41", "5", "36", "8.1%"],
        ["Дроп", "29", "4", "25", "5.9%"],
        ["Депоинт", "21", "2", "19", "9.7%"],
        ["Ванная", "35", "4", "31", "8.8%"],
    ]
    draw_table(c, M, y - 50, [210, 100, 110, 120, 150], rows)
    text(c, M, 58, "Для плитки этот блок переключится на конкурентов: Плитка и ЛеоКерамика.", 10, PALETTE["muted"], REGULAR)


def slide_next(c: canvas.Canvas):
    page_header(c, "5. Что будет в боевой версии", "Минимальный набор параметров для реального отчета", 6)
    rows = [
        ["Параметр", "Как будет задаваться"],
        ["Название акции", "например: Дни Испании"],
        ["Старт акции", "например: 15.06.2026"],
        ["Сегмент IDD", "список кодов товара или сохраненный набор"],
        ["Тип акции", "сантехника или плитка - выбирает набор конкурентов"],
        ["Получатели", "Telegram сейчас, email после согласования"],
    ]
    draw_table(c, M, H - 142, [240, 430], rows, PALETTE["blue"])
    text(c, M, 104, "После утверждения макета автоматизацию можно будет запускать ежедневно в 09:00 за вчерашний день.", 12, PALETTE["ink"], BOLD)
    text(c, M, 78, "Дашборд при этом не меняется: отчет читает данные отдельно и собирает PDF в фоне.", 10, PALETTE["muted"], REGULAR)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=landscape(A4))
    report_date = yesterday()
    for draw in [
        lambda cc: slide_cover(cc, report_date),
        slide_sales,
        slide_content,
        slide_prices,
        slide_competitors,
        slide_next,
    ]:
        draw(c)
        c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    main()
