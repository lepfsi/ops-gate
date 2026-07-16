#!/usr/bin/env python3
"""
Rapport sécurité OpsGate — PDF avec charts (KPIs, tendances, tops).
Entrée : JSON (fichier arg ou stdin)
Sortie : chemin PDF (arg --out) ou stdout bytes si --stdout
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from pdf_brand import (  # noqa: E402
    GRAY,
    INK,
    MUTED,
    NAVY,
    NAVY2,
    TEAL,
    TEAL_SOFT,
    WHITE,
    draw_brand_mark,
    font_name,
    register_fonts,
)

# Palette chart (sober DailyOps)
BAR_TEAL = TEAL
BAR_NAVY = NAVY
BAR_WARN = (245, 158, 11)
BAR_CRIT = (239, 68, 68)
BAR_OK = (16, 185, 129)
BAR_MUTED = (148, 163, 184)


class ReportPDF(FPDF):
    def __init__(self, org_label: str = "OpsGate"):
        super().__init__(format="A4")
        self.org_label = org_label
        self._cover = True

    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_fill_color(*NAVY)
        self.rect(0, 0, self.w, 14, "F")
        draw_brand_mark(self, self.l_margin, 2.2, 9.5)
        self.set_xy(self.l_margin + 13, 3.5)
        self.set_font(font_name(), "B", 9)
        self.set_text_color(*WHITE)
        self.cell(0, 7, f"OpsGate  |  Security Report  |  {self.org_label}")
        self.set_draw_color(*TEAL)
        self.set_line_width(1.2)
        self.line(0, 14, self.w, 14)
        self.set_y(19)

    def footer(self) -> None:
        if self.page_no() == 1:
            return
        self.set_y(-12)
        self.set_draw_color(*TEAL)
        self.set_line_width(0.4)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.set_y(-9)
        self.set_font(font_name(), "", 8)
        self.set_text_color(*GRAY)
        self.cell(
            0,
            6,
            f"Page {self.page_no() - 1}  ·  DailyOps.Tech  ·  Confidentiel",
            align="C",
        )


def uw(pdf: FPDF) -> float:
    return pdf.w - pdf.l_margin - pdf.r_margin


def cover(pdf: ReportPDF, data: dict) -> None:
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, pdf.w, pdf.h, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(0, 0, pdf.w, 6, "F")
    pdf.rect(0, pdf.h - 8, pdf.w, 8, "F")

    mark = 48
    draw_brand_mark(pdf, (pdf.w - mark) / 2, 40, mark)
    pdf.set_y(40 + mark + 12)
    pdf.set_font(font_name(), "B", 26)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 11, "OpsGate", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font_name(), "", 11)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 7, "DailyOps.Tech", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(8)
    pdf.set_font(font_name(), "B", 16)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 9, "Security Activity Report", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    period = data.get("period") or {}
    pdf.set_font(font_name(), "", 12)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 7, period.get("label", ""), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font_name(), "", 9)
    pdf.cell(
        0,
        6,
        f"{(period.get('from_ts') or '')[:10]}  →  {(period.get('to_ts') or '')[:10]}",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(10)
    org = data.get("org_name") or data.get("org_id") or ""
    pdf.set_text_color(*TEAL)
    pdf.set_font(font_name(), "B", 10)
    pdf.cell(0, 6, f"Organisation : {org}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(*MUTED)
    pdf.set_font(font_name(), "", 9)
    gen = (data.get("generated_at") or "")[:19].replace("T", " ")
    pdf.cell(0, 6, f"Généré le {gen} UTC", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(16)
    # mini KPIs on cover
    k = data.get("kpis") or {}
    pdf.set_font(font_name(), "B", 20)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 10, str(k.get("events_total", 0)), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font_name(), "", 10)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 6, "événements sur la période", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.add_page()


def h1(pdf: FPDF, t: str) -> None:
    pdf.ln(2)
    pdf.set_font(font_name(), "B", 13)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(uw(pdf), 7, t)
    y = pdf.get_y()
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(0.9)
    pdf.line(pdf.l_margin, y + 0.3, pdf.l_margin + 28, y + 0.3)
    pdf.ln(3)


def h2(pdf: FPDF, t: str) -> None:
    pdf.ln(1)
    pdf.set_font(font_name(), "B", 10)
    pdf.set_text_color(*NAVY2)
    pdf.multi_cell(uw(pdf), 5.5, t)
    pdf.ln(1)


def kpi_grid(pdf: FPDF, kpis: dict) -> None:
    items = [
        ("Events", kpis.get("events_total", 0), TEAL),
        ("Blocks", kpis.get("blocks", 0), BAR_CRIT),
        ("Mask", kpis.get("masks", 0), BAR_OK),
        ("Risky", kpis.get("risky_sends", 0), BAR_WARN),
        ("Observe", kpis.get("observes", 0), BAR_NAVY),
        ("Agents", kpis.get("agents_total", 0), BAR_MUTED),
        ("Online", kpis.get("agents_online", 0), BAR_OK),
        ("Unlic.", kpis.get("unlicensed", 0), BAR_CRIT),
    ]
    w = uw(pdf)
    col = w / 4
    row_h = 22
    x0 = pdf.l_margin
    y0 = pdf.get_y()
    for i, (lab, val, color) in enumerate(items):
        col_i = i % 4
        row_i = i // 4
        x = x0 + col_i * col
        y = y0 + row_i * (row_h + 4)
        pdf.set_fill_color(*TEAL_SOFT)
        pdf.rect(x + 1, y, col - 3, row_h, "F")
        pdf.set_fill_color(*color)
        pdf.rect(x + 1, y, 2.5, row_h, "F")
        pdf.set_xy(x + 6, y + 3)
        pdf.set_font(font_name(), "B", 14)
        pdf.set_text_color(*NAVY)
        pdf.cell(col - 10, 8, str(val))
        pdf.set_xy(x + 6, y + 12)
        pdf.set_font(font_name(), "", 8)
        pdf.set_text_color(*GRAY)
        pdf.cell(col - 10, 5, lab)
    pdf.set_y(y0 + 2 * (row_h + 4) + 2)


def hbar_chart(
    pdf: FPDF,
    title: str,
    rows: list[tuple[str, int]],
    color=BAR_TEAL,
) -> None:
    if not rows:
        return
    h2(pdf, title)
    max_v = max((c for _, c in rows), default=1) or 1
    bar_max = uw(pdf) - 70
    for label, count in rows:
        if pdf.get_y() > pdf.h - 24:
            pdf.add_page()
        y = pdf.get_y()
        pdf.set_font(font_name(), "", 8)
        pdf.set_text_color(*INK)
        pdf.set_xy(pdf.l_margin, y)
        lab = label if len(label) <= 22 else label[:21] + "…"
        pdf.cell(48, 5.5, lab)
        bw = max(2, (count / max_v) * bar_max)
        pdf.set_fill_color(*color)
        pdf.rect(pdf.l_margin + 50, y + 0.8, bw, 4, "F")
        pdf.set_xy(pdf.l_margin + 50 + bw + 2, y)
        pdf.set_text_color(*GRAY)
        pdf.cell(18, 5.5, str(count))
        pdf.set_y(y + 6.5)
    pdf.ln(2)


def vbar_chart(pdf: FPDF, title: str, days: list[dict]) -> None:
    if not days:
        return
    h2(pdf, title)
    max_v = max((d.get("count") or 0 for d in days), default=1) or 1
    chart_h = 48
    chart_w = uw(pdf)
    x0 = pdf.l_margin
    y0 = pdf.get_y()
    if y0 + chart_h + 16 > pdf.h - 16:
        pdf.add_page()
        y0 = pdf.get_y()
    # axis baseline
    pdf.set_draw_color(*MUTED)
    pdf.set_line_width(0.3)
    pdf.line(x0, y0 + chart_h, x0 + chart_w, y0 + chart_h)
    n = len(days)
    gap = 1.5
    bw = max(2.5, (chart_w - gap * (n + 1)) / max(n, 1))
    for i, d in enumerate(days):
        c = int(d.get("count") or 0)
        h = max(1, (c / max_v) * (chart_h - 2))
        x = x0 + gap + i * (bw + gap)
        y = y0 + chart_h - h
        pdf.set_fill_color(*TEAL)
        pdf.rect(x, y, bw, h, "F")
    # labels every few days
    pdf.set_font(font_name(), "", 6)
    pdf.set_text_color(*GRAY)
    step = max(1, n // 8)
    for i, d in enumerate(days):
        if i % step != 0 and i != n - 1:
            continue
        day = str(d.get("day") or "")[-5:]
        x = x0 + gap + i * (bw + gap)
        pdf.set_xy(x - 2, y0 + chart_h + 1)
        pdf.cell(bw + 6, 4, day)
    pdf.set_y(y0 + chart_h + 10)


def table_simple(pdf: FPDF, headers: list[str], rows: list[list[str]], col_w: list[float]) -> None:
    if pdf.get_y() > pdf.h - 30:
        pdf.add_page()
    pdf.set_fill_color(*NAVY)
    pdf.set_text_color(*WHITE)
    pdf.set_font(font_name(), "B", 8)
    x0 = pdf.l_margin
    for i, h in enumerate(headers):
        pdf.set_x(x0 + sum(col_w[:i]))
        pdf.cell(col_w[i], 6.5, h[:40], fill=True)
    pdf.ln(6.5)
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(0.6)
    pdf.line(x0, pdf.get_y(), x0 + sum(col_w), pdf.get_y())
    fill = False
    for row in rows:
        if pdf.get_y() > pdf.h - 16:
            pdf.add_page()
        if fill:
            pdf.set_fill_color(*TEAL_SOFT)
        else:
            pdf.set_fill_color(*WHITE)
        pdf.set_text_color(*INK)
        pdf.set_font(font_name(), "", 8)
        y = pdf.get_y()
        pdf.rect(x0, y, sum(col_w), 6, "F")
        for i, c in enumerate(row):
            pdf.set_xy(x0 + sum(col_w[:i]), y + 0.5)
            txt = str(c)
            maxc = max(6, int(col_w[i] / 1.7))
            if len(txt) > maxc:
                txt = txt[: maxc - 1] + "…"
            pdf.cell(col_w[i], 5, txt)
        pdf.set_y(y + 6)
        fill = not fill
    pdf.ln(2)


def build(data: dict, out: Path | None, stdout: bool) -> None:
    org = data.get("org_name") or data.get("org_id") or "OpsGate"
    pdf = ReportPDF(org_label=str(org)[:40])
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(16, 20, 16)
    register_fonts(pdf)
    pdf.add_page()
    cover(pdf, data)

    kpis = data.get("kpis") or {}
    h1(pdf, "1. Synthèse exécutive")
    pdf.set_font(font_name(), "", 9)
    pdf.set_text_color(*INK)
    period = data.get("period") or {}
    pdf.multi_cell(
        uw(pdf),
        5,
        f"Période : {period.get('label', '')}. "
        f"Ce rapport compile l'activité de détection OpsGate (extension + proxy) "
        f"sur l'organisation : indicateurs, tendances et top menaces.",
    )
    pdf.ln(2)
    kpi_grid(pdf, kpis)

    h1(pdf, "2. Activité dans le temps")
    vbar_chart(pdf, "Événements par jour", data.get("events_by_day") or [])

    h1(pdf, "3. Décisions & sévérité")
    dec = [
        (d.get("decision", ""), int(d.get("count") or 0))
        for d in (data.get("by_decision") or [])
    ]
    hbar_chart(pdf, "Répartition des décisions", dec, BAR_NAVY)
    sev = [
        (d.get("severity", ""), int(d.get("count") or 0))
        for d in (data.get("by_severity") or [])
    ]
    hbar_chart(pdf, "Sévérité", sev, BAR_WARN)
    src = [
        (d.get("source", ""), int(d.get("count") or 0))
        for d in (data.get("by_source") or [])
    ]
    hbar_chart(pdf, "Sources", src, TEAL)

    h1(pdf, "4. Top menaces & cibles")
    rules = data.get("top_rules") or []
    if rules:
        h2(pdf, "Top règles déclenchées")
        w = uw(pdf)
        table_simple(
            pdf,
            ["Règle", "Count"],
            [[r.get("rule_id", ""), str(r.get("count", 0))] for r in rules],
            [w * 0.75, w * 0.25],
        )
    hosts = data.get("top_hosts") or []
    if hosts:
        h2(pdf, "Top sites / hosts")
        w = uw(pdf)
        table_simple(
            pdf,
            ["Hostname", "Count"],
            [[h.get("hostname", ""), str(h.get("count", 0))] for h in hosts],
            [w * 0.75, w * 0.25],
        )
    devices = data.get("top_devices") or []
    if devices:
        h2(pdf, "Top appareils")
        w = uw(pdf)
        table_simple(
            pdf,
            ["Device", "Count"],
            [[d.get("device_label", ""), str(d.get("count", 0))] for d in devices],
            [w * 0.75, w * 0.25],
        )

    h1(pdf, "5. Connectivité flotte (instantané)")
    conn = data.get("connectivity") or {}
    w = uw(pdf)
    table_simple(
        pdf,
        ["Statut", "Nombre"],
        [
            ["En ligne", str(conn.get("online", 0))],
            ["Inactif", str(conn.get("stale", 0))],
            ["Hors ligne prolongé", str(conn.get("offline_long", 0))],
            ["Maintenance", str(conn.get("maintenance", 0))],
            [
                "Licences (lic / grace / unlic)",
                f"{kpis.get('licensed', 0)} / {kpis.get('grace', 0)} / {kpis.get('unlicensed', 0)}",
            ],
        ],
        [w * 0.55, w * 0.45],
    )

    # closing
    pdf.ln(8)
    if pdf.get_y() > pdf.h - 36:
        pdf.add_page()
    y = pdf.get_y()
    pdf.set_fill_color(*NAVY)
    pdf.rect(pdf.l_margin, y, uw(pdf), 28, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(pdf.l_margin, y, uw(pdf), 2.2, "F")
    draw_brand_mark(pdf, pdf.l_margin + 6, y + 5, 16)
    pdf.set_xy(pdf.l_margin + 28, y + 7)
    pdf.set_font(font_name(), "B", 9)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 5, "OPSGATE  ·  DAILYOPS.TECH")
    pdf.set_xy(pdf.l_margin + 28, y + 14)
    pdf.set_font(font_name(), "", 9)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 5, "Security Activity Report — usage interne / comité sécurité")

    if stdout:
        sys.stdout.buffer.write(pdf.output())
    else:
        assert out is not None
        out.parent.mkdir(parents=True, exist_ok=True)
        pdf.output(str(out))
        print(f"Wrote {out}", file=sys.stderr)


def main() -> None:
    args = sys.argv[1:]
    out = None
    stdout = "--stdout" in args
    if "--out" in args:
        i = args.index("--out")
        out = Path(args[i + 1])
    # input
    if args and not args[0].startswith("-"):
        data = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    else:
        data = json.load(sys.stdin)
    if not out and not stdout:
        out = ROOT / "docs" / "reports" / "opsgate-security-report.pdf"
    build(data, out, stdout)


if __name__ == "__main__":
    main()
