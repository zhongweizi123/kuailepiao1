#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
快乐票1 —— 爬虫脚本
数据源：中国竞彩网官方接口（webapi.sporttery.cn），抓取竞彩足球在售场次的
        胜平负 / 让球胜平负 / 比分 / 总进球 / 半全场 五种玩法及其历史走势快照。
输出：js/live-data.js（window.KLP_DATA），供网站首页/详情页直接读取。

用法：python crawler.py
依赖：仅用 Python 标准库，无需安装任何第三方包。
合规：只抓取官方公开的赔率数据用于展示与统计，不做销售/代购；
      本脚本会为每场额外请求一次历史走势接口（在场次数量级下可控），
      正式定时任务建议 5~10 分钟一次，控制对官方接口的访问频率。
"""
import json
import os
import time
import urllib.request
from datetime import datetime

# 官方接口地址（poolCode: had=胜平负, hhad=让球胜平负）
URL = ('https://webapi.sporttery.cn/gateway/jc/football/'
       'getMatchCalculatorV1.qry?poolCode=had,hhad&channel=c&clientCode=3001')

# 单场历史走势接口：一次返回该场全部五种玩法的完整快照
HIST_URL = ('https://webapi.sporttery.cn/gateway/uniform/football/'
            'getOddsHistoryV1.qry?matchId={mid}&poolCode=had,hhad,crs,ttg,hafu')

# 官方接口做了防盗链，必须带 User-Agent 和 Referer
HEADERS = {
    'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                   'AppleWebKit/537.36 (KHTML, like Gecko) '
                   'Chrome/120.0 Safari/537.36'),
    'Referer': 'https://www.sporttery.cn/',
}

# 相邻两次历史请求的间隔（秒），避免过快访问官方接口
REQUEST_DELAY = 0.15

# 输出文件（与本脚本同级的 js/live-data.js）
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js')
OUT_FILE = os.path.join(OUT_DIR, 'live-data.js')

# ---- 各玩法选项定义：(字段代码, 显示名, 分组) ----
# 分组仅比分玩法使用（胜/平/负），其余玩法为 None
SPF_DEFS = [('h', '主胜', None), ('d', '平', None), ('a', '客胜', None)]

CRS_DEFS = [
    # 主胜（含胜其他）
    ('s01s00', '1:0', '主胜'), ('s02s00', '2:0', '主胜'), ('s02s01', '2:1', '主胜'),
    ('s03s00', '3:0', '主胜'), ('s03s01', '3:1', '主胜'), ('s03s02', '3:2', '主胜'),
    ('s04s00', '4:0', '主胜'), ('s04s01', '4:1', '主胜'), ('s04s02', '4:2', '主胜'),
    ('s05s00', '5:0', '主胜'), ('s05s01', '5:1', '主胜'), ('s05s02', '5:2', '主胜'),
    ('s-1sh', '胜其他', '主胜'),
    # 平（含平其他）
    ('s00s00', '0:0', '平'), ('s01s01', '1:1', '平'), ('s02s02', '2:2', '平'),
    ('s03s03', '3:3', '平'), ('s-1sd', '平其他', '平'),
    # 客胜（含负其他）
    ('s00s01', '0:1', '客胜'), ('s00s02', '0:2', '客胜'), ('s01s02', '1:2', '客胜'),
    ('s00s03', '0:3', '客胜'), ('s01s03', '1:3', '客胜'), ('s02s03', '2:3', '客胜'),
    ('s00s04', '0:4', '客胜'), ('s01s04', '1:4', '客胜'), ('s02s04', '2:4', '客胜'),
    ('s00s05', '0:5', '客胜'), ('s01s05', '1:5', '客胜'), ('s02s05', '2:5', '客胜'),
    ('s-1sa', '负其他', '客胜'),
]

TTG_DEFS = [
    ('s0', '0', None), ('s1', '1', None), ('s2', '2', None), ('s3', '3', None),
    ('s4', '4', None), ('s5', '5', None), ('s6', '6', None), ('s7', '7+', None),
]

HAFU_DEFS = [
    ('hh', '胜胜', None), ('hd', '胜平', None), ('ha', '胜负', None),
    ('dh', '平胜', None), ('dd', '平平', None), ('da', '平负', None),
    ('ah', '负胜', None), ('ad', '负平', None), ('aa', '负负', None),
]


def fetch_json(url):
    """请求官方接口并返回解析后的 JSON。"""
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


def fetch_history(match_id):
    """拉取某场次的历史走势，失败返回 None（调用方回退到当前赔率）。"""
    try:
        data = fetch_json(HIST_URL.format(mid=match_id))
        if data.get('errorCode') not in ('0', 0):
            return None
        return data.get('value') or {}
    except Exception:
        return None


def fnum(s):
    """把字符串安全转成 float，失败返回 None。"""
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def short_time(date, time):
    """'2026-08-15' + '18:43:19' -> '08-15 18:43'"""
    d = (date or '')[-5:]
    t = (time or '')[:5]
    return (d + ' ' + t).strip()


def build_play(snaps, label, option_defs, handicap=None):
    """
    根据一串历史快照 + 选项定义构造一个玩法。
    快照按时间升序（旧→新），得到 times 与各选项 values。
    返回 { label, [handicap], [times], options:[{name,[group],initial,current,values}] }
    若无有效快照，返回 None。
    """
    if not snaps:
        return None
    snaps = list(snaps)
    snaps.sort(key=lambda o: (o.get('updateDate', '') + o.get('updateTime', '')))
    # 去重：同一时点、同一组赔率只保留一条
    seen = set()
    unique = []
    for o in snaps:
        key = (o.get('updateDate'), o.get('updateTime')) + tuple(o.get(c) for c, _, _ in option_defs)
        if key in seen:
            continue
        seen.add(key)
        unique.append(o)
    snaps = unique
    if not snaps:
        return None

    times = [short_time(o.get('updateDate'), o.get('updateTime')) for o in snaps]

    options = []
    for code, name, group in option_defs:
        vals = [fnum(o.get(code)) for o in snaps]
        vals = [v for v in vals if v is not None]
        initial = vals[0] if vals else 0.0
        current = vals[-1] if vals else 0.0
        opt = {'name': name, 'initial': round(initial, 2), 'current': round(current, 2)}
        if len(vals) >= 1:
            opt['values'] = [round(v, 2) for v in vals]
        if group:
            opt['group'] = group
        options.append(opt)

    play = {'label': label, 'options': options}
    if len(times) >= 1:
        play['times'] = times
    if handicap:
        play['handicap'] = handicap
    return play


def handicap_label(cur):
    """让球说明：goalLine 为负=主队让球，为正=主队受让，0/缺省=平手。"""
    g = fnum(cur.get('goalLine') or cur.get('goalLineValue'))
    if g is None or g == 0:
        return '平手'
    g = int(g)
    return ('主让%d球' % abs(g)) if g < 0 else ('主受让%d球' % g)


def main():
    data = fetch_json(URL)
    if data.get('errorCode') not in ('0', 0):
        print('接口返回错误：', data.get('errorCode'), data.get('errorMessage'))
        return

    groups = (data.get('value') or {}).get('matchInfoList') or []
    now = datetime.now()

    matches = []
    total = 0
    for g in groups:
        for m in (g.get('subMatchList') or []):
            # 只要在售（Selling）的场次
            if m.get('matchStatus') != 'Selling':
                continue
            total += 1
            mid = str(m.get('matchId'))
            rq_hcap = handicap_label(m.get('hhad') or {})

            # 优先用【历史走势接口】的完整快照；失败则回退到计算器接口的当前赔率
            hist = fetch_history(mid)
            if hist:
                spf = build_play(hist.get('hadList') or [], '胜平负', SPF_DEFS)
                rq = build_play(hist.get('hhadList') or [], '让球胜平负', SPF_DEFS, handicap=rq_hcap)
                crs = build_play(hist.get('crsList') or [], '比分', CRS_DEFS)
                ttg = build_play(hist.get('ttgList') or [], '总进球', TTG_DEFS)
                hafu = build_play(hist.get('hafuList') or [], '半全场', HAFU_DEFS)
            else:
                spf = build_play(
                    [o for o in (m.get('oddsList') or []) if o.get('poolCode') == 'HAD'],
                    '胜平负', SPF_DEFS)
                rq = build_play(
                    [o for o in (m.get('oddsList') or []) if o.get('poolCode') == 'HHAD'],
                    '让球胜平负', SPF_DEFS, handicap=rq_hcap)
                crs = ttg = hafu = None

            if spf is None:
                continue

            plays = {'spf': spf}
            for key, play in (('rqspf', rq), ('crs', crs), ('ttg', ttg), ('hafu', hafu)):
                if play is not None:
                    plays[key] = play

            matches.append({
                'id': mid,
                'type': 'jc',
                'no': m.get('matchNumStr') or '',
                'league': m.get('leagueAbbName') or m.get('leagueAllName') or '',
                'leagueFull': m.get('leagueAllName') or '',
                'home': m.get('homeTeamAllName') or '',
                'away': m.get('awayTeamAllName') or '',
                'homeRank': m.get('homeRank') or '',
                'awayRank': m.get('awayRank') or '',
                # 开赛时间（完整日期 + 时分）
                'matchTime': (m.get('matchDate') or '') + ' ' + (m.get('matchTime') or '')[:5],
                'status': 'sale',
                'plays': plays,
            })
            print('  [%d/%d] %s vs %s（玩法 %d 种）'
                  % (len(matches), total, matches[-1]['home'], matches[-1]['away'], len(plays)))
            time.sleep(REQUEST_DELAY)

    # 按开赛时间排序
    matches.sort(key=lambda x: x['matchTime'])

    result = {
        'generatedAt': now.strftime('%Y-%m-%d %H:%M'),
        'source': '中国竞彩网（官方）',
        'matches': matches,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    js = 'window.KLP_DATA = ' + json.dumps(result, ensure_ascii=False, indent=1) + ';\n'
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write(js)

    with_trend = sum(1 for m in matches
                     if len((m['plays'].get('spf') or {}).get('times') or []) >= 2)
    print('抓取完成：共 %d 场在售，其中 %d 场已有走势图数据（≥2 条快照）'
          % (len(matches), with_trend))
    print('数据已写入：', OUT_FILE)
    print('数据更新时间：', result['generatedAt'])


if __name__ == '__main__':
    main()
