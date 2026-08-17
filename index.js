// dsh-lark-meeting-notifier — Host half
// Registers two webServer routes that the Client half fetches:
//   GET /dsh-lark-meeting/list?day=today|tomorrow  ->  { ok, meetings }
//   GET /dsh-lark-meeting/health                   ->  { ok, installed, authorized, userName, hint }
// Meetings are read through the lark-cli (`@larksuite/cli`) as the logged-in user.

export const name = 'dsh-lark-meeting-notifier'
export const inject = ['shell', 'webServer']

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

function dateStr(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function friendlyError(text) {
  const t = String(text || '')
  if (/command not found|no such file/i.test(t)) {
    return 'lark-cli 未安装，请先运行：npm install -g @larksuite/cli'
  }
  if (/authorization|unauthorized|missing_scope|token|login|authentication|scope/i.test(t)) {
    return '飞书未授权或缺少日历权限，请先运行：lark-cli auth login --scope "calendar:calendar:readonly"'
  }
  return t.slice(0, 300)
}

export function apply(ctx) {
  function execLark(args) {
    const spec = ctx.shell.resolve({
      // Prepend common Homebrew bin dirs: the desktop app boots with a minimal
      // PATH (/usr/bin:/bin:/usr/sbin:/sbin), and lark-cli (a node script) needs
      // both `lark-cli` and `node` discoverable.
      command: 'PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1 lark-cli ' + args,
      timeoutMs: 30000,
      stdoutMaxBytes: 2 * 1024 * 1024,
      sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: '/' },
    })
    return ctx.shell.run(spec).then(function (result) {
      if (result.exitCode !== 0) {
        throw new Error(String(
          (result.stderr && result.stderr.text) ||
          (result.stdout && result.stdout.text) ||
          'lark-cli failed',
        ))
      }
      return result.stdout.text
    })
  }

  async function runLark(args) {
    return JSON.parse(await execLark(args))
  }

  async function fetchMeetings(day) {
    const rangeArg = day === 'tomorrow'
      ? ' --start ' + dateStr(1) + ' --end ' + dateStr(1)
      : ''
    const agenda = await runLark('calendar +agenda --as user' + rangeArg)
    const now = Date.now()
    const upcoming = (agenda.data || [])
      .filter(function (e) { return e && e.event_id && e.summary && e.start_time && e.end_time })
      .filter(function (e) { return new Date(e.start_time.datetime).getTime() > now })
      .sort(function (a, b) { return a.start_time.datetime < b.start_time.datetime ? -1 : 1 })

    const meetings = await Promise.all(upcoming.map(async function (e) {
      let room = ''
      try {
        const detailId = e.is_exception ? e.event_id : (e.recurring_event_id || e.event_id)
        const detail = await runLark('calendar events get --calendar-id primary --event-id ' + detailId + ' --need-attendee')
        const ev = detail.data && detail.data.event
        const resource = ((ev && ev.attendees) || []).find(function (a) { return a && a.type === 'resource' })
        if (resource) room = resource.display_name || resource.name || ''
      } catch (e2) { /* room is optional */ }
      return {
        id: e.event_id,
        summary: e.summary,
        start: e.start_time.datetime,
        end: e.end_time.datetime,
        organizer: (e.event_organizer && e.event_organizer.display_name) || '',
        meetingUrl: (e.vchat && e.vchat.meeting_url) || '',
        rsvp: e.self_rsvp_status || '',
        room: room,
      }
    }))

    return { ok: true, meetings: meetings }
  }

  function replyJson(res, data) {
    const body = JSON.stringify(data)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(body)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-lark-meeting/list',
    handler: async function (req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const url = new URL(req.url || '/', 'http://x')
      const day = url.searchParams.get('day') === 'tomorrow' ? 'tomorrow' : 'today'
      try {
        replyJson(res, await fetchMeetings(day))
      } catch (error) {
        replyJson(res, { ok: false, error: friendlyError(error && error.message ? error.message : error) })
      }
    },
  }), 'lark-meeting-notifier: /list')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-lark-meeting/health',
    handler: async function (req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        await execLark('--version')
      } catch (e) {
        replyJson(res, { ok: true, installed: false, authorized: false, userName: '', hint: 'lark-cli 未安装：npm install -g @larksuite/cli' })
        return
      }
      try {
        const st = await runLark('auth status --json --verify')
        const authorized = !!(st && st.verified === true && st.identity === 'user')
        const u = (st && st.identities && st.identities.user) || {}
        replyJson(res, {
          ok: true,
          installed: true,
          authorized: authorized,
          userName: u.userName || '',
          hint: authorized ? '' : '飞书未授权：lark-cli auth login --scope "calendar:calendar:readonly"',
        })
      } catch (e) {
        replyJson(res, { ok: true, installed: true, authorized: false, userName: '', hint: friendlyError(e.message) })
      }
    },
  }), 'lark-meeting-notifier: /health')
}
