// dsh-lark-meeting-notifier — Client half (browser)
// Registers a right-side floating panel (shell.overlay) and a settings section.
window.__ModuleLoader__.load({
  id: "dsh-lark-meeting-notifier",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");

    const LEAD_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
    const REFRESH_OPTIONS = [{ value: 30, label: '30秒' }, { value: 60, label: '60秒' }, { value: 120, label: '120秒' }];
    const DEFAULT_CONFIG = { leadMinutes: [20, 10, 5], autoStop: true, refreshSeconds: 30, autoExpand: true, roomNameStyle: 'full' };

    let latestMeetings = [];
    const expandedFor = [];
    let prevVisibleCount = -1;

    function loadConfig() {
      try {
        const raw = JSON.parse(localStorage.getItem('dsh.meeting.config') || 'null');
        if (raw && typeof raw === 'object') {
          return {
            leadMinutes: Array.isArray(raw.leadMinutes) ? raw.leadMinutes.slice() : DEFAULT_CONFIG.leadMinutes,
            autoStop: typeof raw.autoStop === 'boolean' ? raw.autoStop : DEFAULT_CONFIG.autoStop,
            refreshSeconds: (raw.refreshSeconds === 60 || raw.refreshSeconds === 120) ? raw.refreshSeconds : DEFAULT_CONFIG.refreshSeconds,
            autoExpand: typeof raw.autoExpand === 'boolean' ? raw.autoExpand : DEFAULT_CONFIG.autoExpand,
            roomNameStyle: raw.roomNameStyle === 'short' ? 'short' : 'full',
          };
        }
      } catch (e) { /* ignore */ }
      return {
        leadMinutes: DEFAULT_CONFIG.leadMinutes.slice(),
        autoStop: DEFAULT_CONFIG.autoStop,
        refreshSeconds: DEFAULT_CONFIG.refreshSeconds,
        autoExpand: DEFAULT_CONFIG.autoExpand,
        roomNameStyle: DEFAULT_CONFIG.roomNameStyle,
      };
    }

    const configStore = {
      value: loadConfig(),
      listeners: [],
      get: function () { return this.value; },
      set: function (next) {
        this.value = {
          leadMinutes: next.leadMinutes.slice(),
          autoStop: next.autoStop,
          refreshSeconds: next.refreshSeconds,
          autoExpand: next.autoExpand,
          roomNameStyle: next.roomNameStyle,
        };
        try { localStorage.setItem('dsh.meeting.config', JSON.stringify(this.value)); } catch (e) { /* ignore */ }
        this.listeners.slice().forEach(function (fn) { fn(); });
      },
      subscribe: function (fn) {
        this.listeners.push(fn);
        return function () { this.listeners = this.listeners.filter(function (f) { return f !== fn; }); }.bind(this);
      },
    };

    function useConfig() {
      const [cfg, setCfg] = React.useState(configStore.get());
      React.useEffect(function () {
        return configStore.subscribe(function () { setCfg(configStore.get()); });
      }, []);
      return cfg;
    }

    function loadHidden() {
      try { return JSON.parse(localStorage.getItem('dsh.meeting.hidden') || '[]'); } catch (e) { return []; }
    }
    function saveHidden(ids) {
      try { localStorage.setItem('dsh.meeting.hidden', JSON.stringify(ids)); } catch (e) { /* ignore */ }
    }
    function flashTier(L) {
      if (L <= 5) return 'crit';
      if (L <= 10) return 'warn';
      if (L <= 20) return 'soon';
      return 'early';
    }
    function firedLeads(m, nowMs, cfg, silenced) {
      const startMs = new Date(m.start).getTime();
      if (nowMs >= startMs) return [];
      return cfg.leadMinutes.filter(function (L) {
        const fireAt = startMs - L * 60000;
        if (nowMs < fireAt) return false;
        if (silenced[m.id] && silenced[m.id][L]) return false;
        if (cfg.autoStop && nowMs >= fireAt + 30000) return false;
        return true;
      });
    }
    async function fetchList(day) {
      const url = '/dsh-lark-meeting/list' + (day ? '?day=' + day : '');
      const r = await fetch(url);
      return r.json();
    }

    function renderItem(m, nowMs, cfg, silenced, onDismiss, onHide) {
      const fired = firedLeads(m, nowMs, cfg, silenced);
      const flashing = fired.length > 0;
      const mostUrgent = flashing ? Math.min.apply(null, fired) : null;
      const tier = flashing ? flashTier(mostUrgent) : '';
      const cls = 'dsh-meeting-item' + (tier ? ' flash ' + tier : '');
      const startTxt = m.start ? m.start.slice(11, 16) : '';
      const endTxt = m.end ? m.end.slice(11, 16) : '';
      const title = m.meetingUrl
        ? React.createElement('a', { href: m.meetingUrl, target: '_blank', rel: 'noreferrer', style: { color: 'inherit', textDecoration: 'none' } }, m.summary)
        : m.summary;
      const meta = startTxt + (endTxt ? ' - ' + endTxt : '') + (m.organizer ? ' · ' + m.organizer : '');
      const roomText = m.room ? (cfg.roomNameStyle === 'short' ? m.room.split(' ')[0] : m.room) : '';
      const room = roomText ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: 2, fontSize: 12 } }, roomText) : null;
      const urgent = flashing && mostUrgent <= 5 ? React.createElement('div', { style: { color: '#ef4444', fontWeight: 700, marginTop: 2 } }, '即将开始 · 点击关闭提醒') : null;
      const hint = flashing && mostUrgent > 5 ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: 2, fontSize: 11 } }, '点击关闭提醒') : null;
      return React.createElement('div', {
        key: m.id, className: cls,
        onClick: function () { onDismiss(m); },
        style: { padding: '8px 6px', marginBottom: 4, fontSize: 12, cursor: flashing ? 'pointer' : 'default' },
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 6 } },
          React.createElement('div', { style: { minWidth: 0, flex: 1 } },
            React.createElement('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-word' } }, title),
            React.createElement('div', { style: { color: 'var(--dsw-alias-label-primary)', marginTop: 2, fontSize: 12 } }, meta),
            room,
            urgent,
            hint,
          ),
          React.createElement('button', { title: '移除提醒', onClick: function (e) { e.stopPropagation(); onHide(m.id); }, style: { cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', fontSize: 14, padding: '0 2px', lineHeight: 1 } }, '\u2715'),
        ),
      );
    }

    function ToggleRow(props) {
      return React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer' } },
        React.createElement('input', { type: 'checkbox', checked: props.checked, onChange: props.onChange }),
        React.createElement('span', { style: { fontSize: 13 } }, props.label),
      );
    }
    function SegmentedRow(props) {
      return React.createElement('div', { style: { padding: '8px 0' } },
        React.createElement('div', { style: { fontSize: 13, marginBottom: 6 } }, props.label),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          props.options.map(function (opt) {
            const active = props.value === opt.value;
            return React.createElement('button', {
              key: String(opt.value),
              onClick: function () { props.onChange(opt.value); },
              style: { cursor: 'pointer', border: '1px solid ' + (active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'), background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent', color: 'var(--dsw-alias-label-primary)', borderRadius: 6, padding: '4px 10px', fontSize: 12 },
            }, opt.label);
          }),
        ),
      );
    }

    exports.inject = ['slots', 'timer'];

    exports.apply = function (ctx) {
      const styleEl = document.createElement('style');
      styleEl.textContent = [
        '.dsh-meeting-item { border-radius: 8px; }',
        '.dsh-meeting-item.flash { animation: dsh-meeting-flash 1s ease-in-out infinite; }',
        '.dsh-meeting-item.flash.warn { animation-duration: 0.7s; }',
        '.dsh-meeting-item.flash.crit { animation-duration: 0.45s; }',
        '.dsh-meeting-item.flash.early { --flash-color: rgba(59, 130, 246, 0.3); }',
        '.dsh-meeting-item.flash.soon { --flash-color: rgba(250, 204, 21, 0.35); }',
        '.dsh-meeting-item.flash.warn { --flash-color: rgba(249, 115, 22, 0.45); }',
        '.dsh-meeting-item.flash.crit { --flash-color: rgba(239, 68, 68, 0.5); }',
        '@keyframes dsh-meeting-flash { 0%, 100% { background-color: transparent; } 50% { background-color: var(--flash-color); } }',
      ].join('\n');
      document.head.append(styleEl);
      ctx.effect(function () { return function () { styleEl.remove(); }; });

      function MeetingReminder() {
        const cfg = useConfig();
        const [meetings, setMeetings] = React.useState([]);
        const [hidden, setHidden] = React.useState(function () { return loadHidden(); });
        const [silenced, setSilenced] = React.useState({});
        const [collapsed, setCollapsed] = React.useState(true);
        const [now, setNow] = React.useState(Date.now());
        const [error, setError] = React.useState('');
        const [tomorrow, setTomorrow] = React.useState(null);
        const [viewingTomorrow, setViewingTomorrow] = React.useState(false);

        React.useEffect(function () {
          const fetchMeetings = function () {
            fetchList().then(function (r) {
              if (r && r.ok) {
                latestMeetings = r.meetings || [];
                setMeetings(latestMeetings);
                setError('');
              } else {
                setError(r && r.error ? r.error : '加载失败');
              }
            }).catch(function (e) { setError(String(e && e.message ? e.message : e)); });
          };
          fetchMeetings();
          return ctx.interval(fetchMeetings, cfg.refreshSeconds * 1000);
        }, [cfg.refreshSeconds]);

        React.useEffect(function () {
          const tick = function () {
            const nowMs = Date.now();
            setNow(nowMs);
            const cfgNow = configStore.get();
            if (cfgNow.autoExpand) {
              const hiddenNow = loadHidden();
              latestMeetings.forEach(function (m) {
                if (hiddenNow.indexOf(m.id) !== -1) return;
                const startMs = new Date(m.start).getTime();
                cfgNow.leadMinutes.forEach(function (L) {
                  const fireAt = startMs - L * 60000;
                  if (nowMs >= fireAt && nowMs < startMs) {
                    const key = m.id + ':' + L;
                    if (expandedFor.indexOf(key) === -1) {
                      expandedFor.push(key);
                      setCollapsed(false);
                    }
                  }
                });
              });
            }
          };
          tick();
          return ctx.interval(tick, 5000);
        }, []);

        const visible = meetings.filter(function (m) { return hidden.indexOf(m.id) === -1; });
        const tomorrowVisible = viewingTomorrow ? (tomorrow || []).filter(function (m) { return hidden.indexOf(m.id) === -1; }) : [];

        React.useEffect(function () {
          if (visible.length === 0 && prevVisibleCount > 0) setCollapsed(true);
          prevVisibleCount = visible.length;
        }, [visible.length]);

        const dismiss = function (m) {
          const nowMs = Date.now();
          const startMs = new Date(m.start).getTime();
          const firedNow = cfg.leadMinutes.filter(function (L) { return nowMs >= startMs - L * 60000; });
          setSilenced(function (prev) {
            const next = {};
            Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
            const entry = {};
            Object.keys(next[m.id] || {}).forEach(function (k) { entry[k] = (next[m.id] || {})[k]; });
            firedNow.forEach(function (L) { entry[L] = true; });
            next[m.id] = entry;
            return next;
          });
        };
        const hideMeeting = function (id) { const next = hidden.concat([id]); setHidden(next); saveHidden(next); };
        const toggleTomorrow = function () {
          if (viewingTomorrow) {
            setViewingTomorrow(false);
          } else {
            setViewingTomorrow(true);
            fetchList('tomorrow').then(function (r) {
              setTomorrow(r && r.ok ? (r.meetings || []) : []);
            }).catch(function () { setTomorrow([]); });
          }
        };

        const pill = React.createElement('button', {
          onClick: function () { setCollapsed(false); },
          style: { pointerEvents: 'auto', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px 0 0 10px', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', padding: '8px 10px', fontSize: 12, boxShadow: 'var(--dsw-shadow-lv2)', display: 'flex', alignItems: 'center', gap: 6 },
        },
          React.createElement('span', null, '\uD83D\uDD50 会议'),
          React.createElement('span', { style: { opacity: 0.7 } }, String(visible.length)),
        );

        if (collapsed) {
          return React.createElement('div', { style: { position: 'fixed', right: 0, top: 96, zIndex: 30, display: 'flex', alignItems: 'center' } }, pill);
        }

        const header = React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px 12px 0 0', padding: '10px 12px' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            React.createElement('span', { style: { fontWeight: 600, fontSize: 13 } }, '飞书会议提醒'),
            visible.length === 0 ? React.createElement('button', { onClick: toggleTomorrow, style: { cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--dsw-alias-state-business-primary)', fontSize: 12, padding: 0 } }, viewingTomorrow ? '隐藏明日' : '明日') : null,
          ),
          React.createElement('button', { onClick: function () { setCollapsed(true); }, style: { cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } }, '收起'),
        );

        const body = error
          ? React.createElement('div', { style: { padding: 12, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap' } }, error)
          : viewingTomorrow
            ? (tomorrow === null
                ? React.createElement('div', { style: { padding: 12, fontSize: 12, opacity: 0.6 } }, '加载中…')
                : tomorrowVisible.length === 0
                  ? React.createElement('div', { style: { padding: 12, fontSize: 12, opacity: 0.6 } }, '明天暂无会议')
                  : tomorrowVisible.map(function (m) { return renderItem(m, now, cfg, silenced, dismiss, hideMeeting); }))
            : visible.length === 0
              ? React.createElement('div', { style: { padding: 12, fontSize: 12, opacity: 0.6 } }, '今天剩余时间暂无会议')
              : visible.map(function (m) { return renderItem(m, now, cfg, silenced, dismiss, hideMeeting); });

        const list = React.createElement('div', { style: { overflowY: 'auto', background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l2)', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: 8 } }, body);

        return React.createElement('div', { style: { position: 'fixed', right: 8, top: 96, zIndex: 30, width: 300, maxHeight: '70vh', pointerEvents: 'auto', display: 'flex', flexDirection: 'column' } }, header, list);
      }

      function SettingsSection() {
        const cfg = useConfig();
        const set = function (patch) {
          configStore.set({
            leadMinutes: patch.leadMinutes !== undefined ? patch.leadMinutes : cfg.leadMinutes,
            autoStop: patch.autoStop !== undefined ? patch.autoStop : cfg.autoStop,
            refreshSeconds: patch.refreshSeconds !== undefined ? patch.refreshSeconds : cfg.refreshSeconds,
            autoExpand: patch.autoExpand !== undefined ? patch.autoExpand : cfg.autoExpand,
            roomNameStyle: patch.roomNameStyle !== undefined ? patch.roomNameStyle : cfg.roomNameStyle,
          });
        };
        const toggleLead = function (L) {
          const cur = cfg.leadMinutes;
          const next = cur.indexOf(L) === -1 ? cur.concat([L]) : cur.filter(function (x) { return x !== L; });
          set({ leadMinutes: next });
        };
        return React.createElement('div', { style: { padding: '8px 4px' } },
          React.createElement('div', { style: { marginBottom: 16 } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, '提醒提前时间（可多选，分钟）'),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10 } },
              LEAD_OPTIONS.map(function (L) {
                const checked = cfg.leadMinutes.indexOf(L) !== -1;
                return React.createElement('label', { key: L, style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' } },
                  React.createElement('input', { type: 'checkbox', checked: checked, onChange: function () { toggleLead(L); } }),
                  React.createElement('span', null, L + ' 分钟'),
                );
              }),
            ),
          ),
          React.createElement(ToggleRow, { label: '提醒将在 30 秒后自动停止闪烁', checked: cfg.autoStop, onChange: function () { set({ autoStop: !cfg.autoStop }); } }),
          React.createElement(ToggleRow, { label: '提醒时自动展开', checked: cfg.autoExpand, onChange: function () { set({ autoExpand: !cfg.autoExpand }); } }),
          React.createElement(SegmentedRow, { label: '刷新间隔', value: cfg.refreshSeconds, options: REFRESH_OPTIONS, onChange: function (v) { set({ refreshSeconds: v }); } }),
          React.createElement(SegmentedRow, { label: '会议室名显示', value: cfg.roomNameStyle, options: [{ value: 'full', label: '完整' }, { value: 'short', label: '简短' }], onChange: function (v) { set({ roomNameStyle: v }); } }),
        );
      }

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'meeting-reminder', order: 31, label: '飞书会议提醒' },
          function () { return React.createElement(SettingsSection); },
        );
      });
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          { name: 'shell.overlay', id: 'meeting-reminder', order: 0, label: '飞书会议提醒' },
          function () { return React.createElement(MeetingReminder); },
        );
      });
    };

    return module.exports;
  }
});
