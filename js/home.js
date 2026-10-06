/**
 * 快乐票1 —— 首页逻辑（真实数据版）
 * 功能：按日期分组展示在售场次、开赛倒计时、赔率涨跌标记、信号角标。
 */
const { createApp, ref, computed, onMounted, onUnmounted } = Vue;

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

createApp({
  setup() {
    const data = KLP_DATA;
    const now = ref(new Date());
    let timer = null;

    onMounted(function () { timer = setInterval(function () { now.value = new Date(); }, 1000); });
    onUnmounted(function () { clearInterval(timer); });

    // 按开赛日期分组（保持时间顺序）
    const groups = computed(function () {
      const map = {};
      data.matches.forEach(function (m) {
        const d = m.matchTime.split(' ')[0];
        (map[d] = map[d] || []).push(m);
      });
      return Object.keys(map).map(function (d) { return { date: d, matches: map[d] }; });
    });

    // 距开赛倒计时文本
    function countdown(m) {
      const diff = new Date(m.matchTime.replace(' ', 'T')) - now.value;
      if (diff <= 0) return '已开赛';
      return KLP_SIGNALS.fmt(diff);
    }

    // 某选项的涨跌信息（降绿 / 升红 / 持平灰）
    function change(o) {
      const p = KLP_SIGNALS.pct(o.initial, o.current);
      return { p: p, dir: p < -0.05 ? 'down' : (p > 0.05 ? 'up' : 'flat') };
    }

    // 日期分组标题：'今天 周六' / '08-16 周日'
    function dateLabel(d) {
      const dt = new Date(d + 'T00:00:00');
      const today = new Date();
      const t = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      return (d === t ? '今天' : d.slice(5)) + ' ' + WEEK[dt.getDay()];
    }

    // 场次卡片上的信号角标（简要版，完整见详情页）
    function badge(m) {
      const a = KLP_SIGNALS.analyze(m);
      for (const o of a.options) {
        if (o.sigs.includes('s1')) return { text: '💡 ' + o.name + ' 降赔 ' + Math.abs(o.pct).toFixed(0) + '%', risk: false };
        if (o.sigs.includes('s3')) return { text: '⚠️ ' + o.name + ' 升赔 ' + o.pct.toFixed(0) + '%', risk: true };
        if (o.sigs.includes('s2')) return { text: '💡 低赔参考：' + o.name + ' ' + o.current.toFixed(2), risk: false };
      }
      return null;
    }

    // 首页卡片"更多玩法"提示（除胜平负/让球外的玩法）
    function playSummary(m) {
      const keys = Object.keys(m.plays).filter(function (k) { return k !== 'spf' && k !== 'rqspf'; });
      if (!keys.length) return '';
      return '更多玩法：' + keys.map(function (k) { return m.plays[k].label; }).join('、');
    }

    return { data: data, groups: groups, countdown: countdown, change: change, dateLabel: dateLabel, badge: badge, playSummary: playSummary };
  }
}).mount('#app');
