/**
 * 快乐票1 —— 场次详情页逻辑（真实数据版）
 * 功能：玩法切换、ECharts 赔率走势折线图、赔率变动明细、信号提示（诚实标注数据积累中）。
 */
const { createApp, ref, computed, onMounted, onUnmounted, nextTick } = Vue;

// 从地址栏取场次编号，缺省用第一场
const qs = new URLSearchParams(location.search);
const matchId = qs.get('id') || (KLP_DATA.matches.length ? KLP_DATA.matches[0].id : '');
const match = KLP_DATA.matches.find(function (m) { return m.id === matchId; }) || KLP_DATA.matches[0];

// 折线颜色：胜平负固定三色
const SPF_COLORS = { '主胜': '#ff5b5b', '平': '#9aa3b8', '客胜': '#4d8dff' };
const PALETTE = ['#ff5b5b', '#4d8dff', '#f7b955', '#42c8b0', '#b07ce8', '#e87cc2', '#8fd14f', '#c4c9d6'];

function buildChartOption(m, play) {
  const series = play.options.map(function (o, idx) {
    const color = SPF_COLORS[o.name] || PALETTE[idx % PALETTE.length];
    const vals = o.values || [];

    // 显著变动点标记（单次变动 ≥ 0.10）
    const markPoints = [];
    for (let i = 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      if (Math.abs(d) >= 0.1) {
        markPoints.push({
          coord: [play.times[i], vals[i]],
          value: (d < 0 ? '↓' : '↑') + Math.abs(d).toFixed(2),
          symbolSize: 30,
          itemStyle: { color: d < 0 ? '#00c48c' : '#ff5b5b' },
          label: { color: '#fff', fontSize: 9 }
        });
      }
    }

    return {
      name: o.name,
      type: 'line',
      data: vals,
      smooth: true,
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { width: 2, color: color },
      itemStyle: { color: color },
      markPoint: { data: markPoints },
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { type: 'dashed', color: '#5a6380', width: 1 },
        label: { formatter: '初盘 ' + o.initial.toFixed(2), color: '#8b93a7', fontSize: 10 },
        data: [{ yAxis: o.initial }]
      }
    };
  });

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1b2438', borderColor: '#39415a',
      textStyle: { color: '#e8eaf0', fontSize: 12 },
      formatter: function (params) {
        let html = '<b>' + params[0].axisValue + '</b><br/>';
        params.forEach(function (p) {
          const opt = play.options[p.seriesIndex];
          const chg = ((p.value - opt.initial) / opt.initial) * 100;
          const arrow = chg < -0.05 ? '↓' : (chg > 0.05 ? '↑' : '—');
          html += p.marker + p.seriesName + '：<b>' + p.value + '</b>'
            + ' <span style="font-size:11px;color:#8b93a7">较初盘 ' + arrow + ' ' + Math.abs(chg).toFixed(1) + '%</span><br/>';
        });
        return html;
      }
    },
    legend: { type: 'scroll', top: 0, textStyle: { color: '#c6cddb', fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 44, right: 20, top: 34, bottom: 52 },
    xAxis: {
      type: 'category', data: play.times,
      axisLabel: { color: '#8b93a7', fontSize: 9, rotate: 25 },
      axisLine: { lineStyle: { color: '#39415a' } }
    },
    yAxis: {
      type: 'value', scale: true,
      axisLabel: { color: '#8b93a7' },
      splitLine: { lineStyle: { color: '#232b40' } }
    },
    series: series,
    dataZoom: [
      { type: 'inside' },
      {
        type: 'slider', height: 16, bottom: 8,
        borderColor: '#2a3350', backgroundColor: '#121828',
        textStyle: { color: '#8b93a7' },
        dataBackground: { lineStyle: { color: '#39415a' }, areaStyle: { color: '#1d263c' } },
        fillerColor: 'rgba(217,38,50,0.15)', handleStyle: { color: '#d92632' }
      }
    ]
  };
}

createApp({
  setup() {
    const data = KLP_DATA;
    const playKey = ref('spf');
    const now = ref(new Date());
    let chart = null;
    let timer = null;

    // 可切换的玩法（胜平负 / 让球胜平负 / 比分 / 总进球 / 半全场）
    const playOrder = Object.keys(match.plays);
    const play = computed(function () { return match.plays[playKey.value]; });
    const hasSeries = computed(function () { return !!play.value.times && play.value.times.length >= 2; });
    // 仅 3 选项玩法（胜平负/让球胜平负）适合画折线；比分/总进球/半全场用表格展示
    const canChart = computed(function () { return play.value.options.length <= 3; });
    const showChart = computed(function () { return canChart.value && hasSeries.value; });
    // 表格行（含比分玩法的胜/平/负分组头）
    const tableRows = computed(function () {
      const rows = [];
      let lastGroup = null;
      play.value.options.forEach(function (o) {
        if (o.group && o.group !== lastGroup) {
          rows.push({ type: 'group', name: o.group });
          lastGroup = o.group;
        }
        rows.push({ type: 'option', opt: o });
      });
      return rows;
    });

    // 信号分析（基于初盘→当前）
    const analysis = KLP_SIGNALS.analyze(match);

    // 距开赛倒计时（实时跳动）
    const countdown = computed(function () {
      const diff = new Date(match.matchTime.replace(' ', 'T')) - now.value;
      return diff <= 0 ? '已开赛' : KLP_SIGNALS.fmt(diff);
    });

    onMounted(function () {
      timer = setInterval(function () { now.value = new Date(); }, 1000);
      renderChart();
    });
    onUnmounted(function () {
      clearInterval(timer);
      if (chart) chart.dispose();
    });

    function switchPlay(k) { playKey.value = k; nextTick(renderChart); }

    function renderChart() {
      if (!showChart.value) { if (chart) { chart.dispose(); chart = null; } return; }
      const el = document.getElementById('chart');
      if (!el) return;
      if (chart) chart.dispose();
      chart = echarts.init(el);
      chart.setOption(buildChartOption(match, play.value));
    }

    // 赔率变动明细（当前玩法，阈值 0.05）
    const changes = computed(function () {
      const p = play.value;
      if (!p.times) return [];
      const rows = [];
      for (let i = p.times.length - 1; i >= 1; i--) {
        p.options.forEach(function (o) {
          if (!o.values) return;
          const d = o.values[i] - o.values[i - 1];
          if (Math.abs(d) >= 0.05) {
            rows.push({ time: p.times[i], name: o.name, from: o.values[i - 1], to: o.values[i], d: d });
          }
        });
      }
      return rows;
    });

    // 信号提示卡片（诚实版：无命中率、无星级）
    const cards = computed(function () {
      const list = [];
      analysis.options.forEach(function (o) {
        if (!o.sigs.length) return;
        const isRisk = o.sigs.indexOf('s3') >= 0;
        list.push({
          kind: isRisk ? 'risk' : 'recommend',
          title: o.name + (isRisk ? ' 升赔风险提示' : ' 建议方向'),
          current: o.current,
          sigTexts: o.sigs.map(function (s) { return KLP_SIGNALS.SIG_NAME[s]; }),
          note: '历史回测数据积累中（需 ≥3 个月真实赔率快照 + 赛果数据），暂无法给出命中率与参考等级。'
        });
      });
      return list;
    });

    function changeCls(o) {
      const p = KLP_SIGNALS.pct(o.initial, o.current);
      return p < -0.05 ? 'down' : (p > 0.05 ? 'up' : 'flat');
    }
    function changeText(o) {
      const p = KLP_SIGNALS.pct(o.initial, o.current);
      if (Math.abs(p) <= 0.05) return '—';
      return (p < 0 ? '↓' : '↑') + Math.abs(p).toFixed(1) + '%';
    }

    return {
      match: match, data: data, playOrder: playOrder, playKey: playKey,
      play: play, hasSeries: hasSeries, canChart: canChart, showChart: showChart,
      tableRows: tableRows, countdown: countdown,
      switchPlay: switchPlay, changes: changes, cards: cards,
      changeCls: changeCls, changeText: changeText
    };
  }
}).mount('#app');
