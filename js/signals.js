/**
 * 快乐票1 —— 信号分析（真实数据版）
 * 说明：基于 初盘→当前 赔率变化做信号提示（降赔 / 低赔 / 升赔）。
 *       历史回测命中率需积累 ≥3 个月真实赔率快照 + 赛果数据后才能计算，
 *       在此之前一律标注"数据积累中"，不展示命中率与星级。
 */
window.KLP_SIGNALS = (function () {
  'use strict';

  function pct(initial, current) { return ((current - initial) / initial) * 100; }

  // 倒计时格式化：X天 HH:MM:SS
  function fmt(diffMs) {
    const s = Math.floor(diffMs / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return (d > 0 ? d + '天 ' : '') + pad(h) + ':' + pad(m) + ':' + pad(sec);
  }

  const SIG_NAME = {
    s1: '降赔信号：初盘→当前降幅 ≥15%',
    s2: '低赔信号：当前赔率 ≤1.50',
    s3: '升赔风险提示：初盘→当前升幅 ≥15%（请谨慎）'
  };

  // 对某场胜平负玩法逐选项判断信号
  function analyze(m) {
    const spf = m.plays.spf;
    const options = [];
    spf.options.forEach(function (o) {
      const p = pct(o.initial, o.current);
      const sigs = [];
      if (p <= -15) sigs.push('s1');
      if (o.current <= 1.5) sigs.push('s2');
      if (p >= 15) sigs.push('s3');
      options.push({ name: o.name, initial: o.initial, current: o.current, pct: p, sigs: sigs });
    });
    return { options: options };
  }

  return { pct: pct, fmt: fmt, analyze: analyze, SIG_NAME: SIG_NAME };
})();
