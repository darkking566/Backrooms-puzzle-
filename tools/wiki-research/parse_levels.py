"""Parse downloaded Backrooms Wiki level pages into a JSON graph.

For each page: title, authors (from the citation block), survival difficulty
snippet, entrances/exits text, and level references found in each.
"""
import html
import json
import os
import re
import sys

D = sys.argv[1]  # directory holding index.json and <slug>.html files


def page_text(s):
    m = re.search(r'<div id="page-content">(.*?)<div class="page-tags"', s, re.S)
    t = m.group(1) if m else s
    t = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', t, flags=re.S)
    t = re.sub(r'<br\s*/?>|</p>|</li>|</h\d>|</div>|</tr>|</td>', '\n', t)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t)
    out, depth = [], 0
    for line in t.split('\n'):
        if depth or '{' in line:
            depth += line.count('{') - line.count('}')
            depth = max(depth, 0)
            continue
        ls = line.strip()
        if not ls or ls.startswith(('/*', '*', '.')):
            continue
        out.append(ls)
    return '\n'.join(out)


LVL = re.compile(r'\bLevel\s+(-?\d+(?:\.\d+)?)\b', re.I)
STOP = re.compile(r'^(Footnotes?|Cite this page|Licensing|‡ Licensing|Discovery|History|Bases?(,| and| &)?.*|Colonies|Outposts|Entities|Addendum|Appendix|Notes?|Trivia|Gallery|Author|Hide author|«|Previous|Next)\b', re.I)
ENT = re.compile(r'^(Entrances?\b|.*Entrances?\s*(and|&)\s*Exits?|How to (enter|get in))', re.I)
EXT = re.compile(r'^(Exits?\b|How to (leave|exit|get out))', re.I)


def sections(text):
    lines = text.split('\n')
    ent, ext, cur = [], [], None
    for ln in lines:
        if len(ln) < 60 and ENT.match(ln):
            ent, ext = [], []  # later heading wins (skips table-of-contents entries)
            cur = ent if not re.search(r'exit', ln, re.I) or re.match(r'^Entrances?$', ln, re.I) else 'both'
            if cur == 'both':
                cur = ent
            continue
        if len(ln) < 40 and EXT.match(ln) and cur is not None:
            cur = ext
            continue
        if cur is not None and len(ln) < 50 and STOP.match(ln):
            cur = None
            continue
        if cur is not None:
            cur.append(ln)
    return '\n'.join(ent)[:4000], '\n'.join(ext)[:4000]


def difficulty(text):
    m = re.search(r'(survival\s+difficulty|survival\s+class|class\s*:)(.{0,120})', text, re.I | re.S)
    return re.sub(r'\s+', ' ', m.group(0))[:140] if m else ''


def cite(s):
    m = re.search(r'Cite this page as:\s*(?:<[^>]+>\s*)*"(.*?)" by (.*?), from the Backrooms Wiki', html.unescape(re.sub(r'<[^>]+>', '', s)), re.S)
    if not m:
        return '', ''
    return m.group(1).strip(), m.group(2).strip()


VERB = re.compile(r'no-?clip|enter|entr|exit|door|lead|leads|access|fall|fell|transport|wake|woke|portal|stair|elevator|passage|reach', re.I)


def narrative(t, slug):
    out = []
    for sent in re.split(r'(?<=[.!?])\s+|\n', t):
        if VERB.search(sent):
            for x in LVL.findall(sent):
                if norm(x) != slug:
                    out.append([norm(x), sent[:240]])
    return out[:40]


def norm(n):
    return 'level-' + n.replace('.', '-')


def main():
    idx = json.load(open(os.path.join(D, 'index.json'), encoding='utf-8'))
    pages = {}
    for slug, meta in idx.items():
        f = os.path.join(D, slug + '.html')
        if not os.path.exists(f) or os.path.getsize(f) < 2000:
            continue
        s = open(f, encoding='utf-8', errors='replace').read()
        t = page_text(s)
        ent, ext = sections(t)
        title, authors = cite(s)
        mentions_all = sorted({norm(x) for x in LVL.findall(t)} - {slug})
        pages[slug] = {
            'name': meta['name'], 'title': meta['title'], 'cite_title': title, 'authors': authors,
            'difficulty': difficulty(t),
            'entrances_text': ent, 'exits_text': ext,
            'entrances_refs': sorted({norm(x) for x in LVL.findall(ent)} - {slug}),
            'exits_refs': sorted({norm(x) for x in LVL.findall(ext)} - {slug}),
            'mentions': mentions_all,
            'manila': 'Manila Room' in t,
            'narrative_refs': narrative(t, slug) if not (ent or ext) else [],
        }
    json.dump(pages, open(os.path.join(D, 'graph.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('parsed', len(pages), 'of', len(idx))


if __name__ == '__main__':
    main()
