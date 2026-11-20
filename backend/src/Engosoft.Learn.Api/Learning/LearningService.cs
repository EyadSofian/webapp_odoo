using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Odoo;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using static Engosoft.Learn.Api.Odoo.OdooClientExtensions;

namespace Engosoft.Learn.Api.Learning;

public sealed class LearningOptions
{
    public const string Section = "Learning";
    public int JoinOpensMinutesBefore { get; set; } = 15;
    public string[] HiddenSessionStages { get; set; } = ["Refused"];
    public string[] CancelledSessionStages { get; set; } = ["Cancelled"];
}

/// <summary>What the caller may do with one live course.</summary>
public sealed record EventAccess(int EventId, string Role, bool Expired, DateTime? AccessUntil, double AttendancePercent, int Attended, int AttendanceTotal);

public sealed record Enrollment(int ChannelId, double Completion, string Status, DateTime? AccessUntil, bool Expired, bool FromEvent);

/// <summary>
/// Reads learning data from Odoo as the integration user and scopes every answer to the caller.
/// Anything the caller is not enrolled in answers 404, so ids cannot be probed.
/// </summary>
public sealed partial class LearningService(
    IOdooClient odoo,
    IMemoryCache cache,
    BunnySigner bunny,
    TimeProvider clock,
    IOptions<LearningOptions> options,
    IOptions<OdooOptions> odooOptions)
{
    private static readonly string[] EventFields =
        ["name", "code", "date_begin", "date_end", "date_tz", "instructor_id", "course_id", "attendance_method", "headquarter", "week_day_ids", "total_lectures_number"];
    private static readonly string[] TrackFields =
        ["name", "event_id", "date", "date_end", "duration", "stage_id", "active_join_live_url", "bunny_video_url"];

    private DateTime Now => clock.GetUtcNow().UtcDateTime;
    private string Website => odooOptions.Value.WebsiteUrl.TrimEnd('/');

    // ------------------------------------------------------------------ access

    public async Task<IReadOnlyDictionary<int, EventAccess>> GetMyEventsAsync(CurrentUser user, CancellationToken ct)
    {
        return (await cache.GetOrCreateAsync($"my-events:{user.PartnerId}:{user.Kind}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60);
            var map = new Dictionary<int, EventAccess>();
            // Everyone sees the courses they are registered in; staff also see the ones they teach (teaching wins).
            {
                var regs = await odoo.SearchReadAsync("event.registration",
                    D(("partner_id", "=", user.PartnerId), ("state", "in", new[] { "open", "done" })),
                    ["event_id", "access_expiration_date", "attendance_progress", "attendance_attended_sessions", "attendance_total_sessions"], ct: ct);
                foreach (var r in regs)
                {
                    if (r.M2O("event_id") is not { } ev) continue;
                    var until = r.Utc("access_expiration_date");
                    var access = new EventAccess(ev.Id, "student", until is not null && until < Now, until,
                        r.Dbl("attendance_progress"), r.Int("attendance_attended_sessions") ?? 0, r.Int("attendance_total_sessions") ?? 0);
                    // A learner can hold two seats on one event (e.g. re-registration): keep the one with the longest access.
                    if (!map.TryGetValue(ev.Id, out var existing) || (existing.AccessUntil ?? DateTime.MaxValue) < (until ?? DateTime.MaxValue))
                        map[ev.Id] = access;
                }
            }
            if (user.IsStaff)
            {
                var employees = await odoo.SearchReadAsync("hr.employee", D(("user_id", "=", user.Uid)), ["id"], includeArchived: true, ct: ct);
                var empIds = employees.Select(e => e.Id()).ToArray();
                if (empIds.Length > 0)
                {
                    var events = await odoo.SearchReadAsync("event.event", D(("instructor_id", "in", empIds)), ["id"], ct: ct);
                    foreach (var e in events)
                        map[e.Id()] = new EventAccess(e.Id(), "instructor", false, null, 0, 0, 0);
                }
            }
            return map;
        }))!;
    }

    private async Task<Result<EventAccess>> RequireEventAsync(CurrentUser user, int eventId, bool needContent, CancellationToken ct)
    {
        var mine = await GetMyEventsAsync(user, ct);
        if (!mine.TryGetValue(eventId, out var access))
            return Error.NotFound("course_not_found", "هذه الدورة ليست ضمن دوراتك.");
        if (needContent && access.Expired)
            return Error.Blocked("access_expired",
                $"انتهت صلاحية هذه الدورة في {access.AccessUntil:yyyy/MM/dd}. للتجديد تواصل مع فريق إنجوسوفت.");
        return access;
    }

    public async Task<IReadOnlyDictionary<int, Enrollment>> GetMyEnrollmentsAsync(CurrentUser user, CancellationToken ct)
    {
        return (await cache.GetOrCreateAsync($"my-courses:{user.PartnerId}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60);
            var rows = await odoo.SearchReadAsync("slide.channel.partner", D(("partner_id", "=", user.PartnerId)),
                ["channel_id", "completion", "member_status", "expiration_date", "is_from_event"], ct: ct);
            var map = new Dictionary<int, Enrollment>();
            foreach (var r in rows)
            {
                if (r.M2O("channel_id") is not { } ch) continue;
                var until = r.Utc("expiration_date");
                map[ch.Id] = new Enrollment(ch.Id, r.Dbl("completion"), r.Str("member_status") ?? "joined", until,
                    until is not null && until < Now, r.Bool("is_from_event"));
            }
            return map;
        }))!;
    }

    private async Task<Result<Enrollment>> RequireChannelAsync(CurrentUser user, int channelId, bool needContent, CancellationToken ct)
    {
        var mine = await GetMyEnrollmentsAsync(user, ct);
        if (!mine.TryGetValue(channelId, out var e))
            return Error.NotFound("course_not_found", "هذه الدورة ليست ضمن دوراتك.");
        if (needContent && e.Expired)
            return Error.Blocked("access_expired", $"انتهت صلاحية هذه الدورة في {e.AccessUntil:yyyy/MM/dd}. للتجديد تواصل مع فريق إنجوسوفت.");
        return e;
    }

    public void Invalidate(CurrentUser user)
    {
        cache.Remove($"my-events:{user.PartnerId}:{user.Kind}");
        cache.Remove($"my-courses:{user.PartnerId}");
    }

    // ------------------------------------------------------------------ live courses

    private async Task<Dictionary<int, JsonElement>> ReadEventsAsync(IEnumerable<int> ids, CancellationToken ct)
    {
        var result = new Dictionary<int, JsonElement>();
        var missing = new List<int>();
        foreach (var id in ids.Distinct())
        {
            if (cache.TryGetValue($"event:{id}", out JsonElement e)) result[id] = e;
            else missing.Add(id);
        }
        foreach (var e in await odoo.ReadAsync("event.event", missing, EventFields, ct))
        {
            cache.Set($"event:{e.Id()}", e, TimeSpan.FromMinutes(5));
            result[e.Id()] = e;
        }
        return result;
    }

    private async Task<List<JsonElement>> ReadTracksAsync(IReadOnlyCollection<int> eventIds, CancellationToken ct)
    {
        if (eventIds.Count == 0) return [];
        var key = $"tracks:{string.Join(',', eventIds.OrderBy(x => x))}";
        return (await cache.GetOrCreateAsync(key, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(45);
            var rows = await odoo.SearchReadAsync("event.track", D(("event_id", "in", eventIds.ToArray())), TrackFields, order: "date asc, id asc", ct: ct);
            var hidden = options.Value.HiddenSessionStages;
            return rows.Where(t => t.M2O("stage_id") is not { } s || !hidden.Contains(s.Name, StringComparer.OrdinalIgnoreCase)).ToList();
        }))!;
    }

    private async Task<Dictionary<int, int>> CountDocumentsAsync(IEnumerable<int> trackIds, CancellationToken ct)
    {
        var ids = trackIds.ToArray();
        if (ids.Length == 0) return [];
        // Only files the instructor uploaded. Zoom chat exports and captions contain other learners' messages.
        var docs = await odoo.SearchReadAsync("event.track.document", D(("track_id", "in", ids), ("source", "=", "manual")), ["track_id"], ct: ct);
        return docs.Where(d => d.M2O("track_id") is not null).GroupBy(d => d.M2O("track_id")!.Value.Id).ToDictionary(g => g.Key, g => g.Count());
    }

    private SessionSummary ToSession(JsonElement t, string eventTitle, int number, bool canUseContent, IReadOnlyDictionary<int, int> docCounts)
    {
        var start = t.Utc("date");
        var end = t.Utc("date_end") ?? start?.AddHours(t.Dbl("duration") is > 0 and var d ? d : 2);
        var now = Now;
        var stage = t.M2O("stage_id")?.Name;
        var cancelled = stage is not null && options.Value.CancelledSessionStages.Contains(stage, StringComparer.OrdinalIgnoreCase);
        var status = cancelled ? SessionStatus.Cancelled
            : start is null ? SessionStatus.Upcoming
            : now < start ? SessionStatus.Upcoming
            : end is not null && now > end ? SessionStatus.Ended
            : SessionStatus.Live;
        var joinOpens = start?.AddMinutes(-options.Value.JoinOpensMinutesBefore);
        var canJoin = canUseContent && status is SessionStatus.Upcoming or SessionStatus.Live
                      && joinOpens is not null && now >= joinOpens
                      && !string.IsNullOrEmpty(t.Str("active_join_live_url"));
        return new SessionSummary(t.Id(), t.M2O("event_id")?.Id ?? 0, eventTitle, CleanTitle(t.Str("name") ?? ""), number, start, end, status,
            canJoin, canUseContent && !string.IsNullOrEmpty(t.Str("bunny_video_url")), docCounts.GetValueOrDefault(t.Id()));
    }

    private LiveCourseCard ToCard(JsonElement ev, EventAccess access, IReadOnlyList<SessionSummary> sessions)
    {
        var instructor = ev.M2O("instructor_id") is { } i ? new InstructorDto(i.Id, i.Name.Trim()) : null;
        var mode = ev.Str("attendance_method") == "offline" ? $"offline:{ev.Str("headquarter") ?? "hq"}" : "online";
        var active = sessions.Where(s => s.Status != SessionStatus.Cancelled).ToList();
        var next = active.FirstOrDefault(s => s.Status is SessionStatus.Live or SessionStatus.Upcoming);
        var total = active.Count > 0 ? active.Count : ev.Int("total_lectures_number") ?? 0;
        return new LiveCourseCard(ev.Id(), CleanTitle(ev.Str("name") ?? ""), ev.Str("code"), ev.M2O("course_id")?.Id, instructor, mode,
            ev.Utc("date_begin"), ev.Utc("date_end"), total, access.Attended, Math.Round(access.AttendancePercent, 1),
            access.AccessUntil, access.Expired, next, access.Role);
    }

    private async Task<(List<LiveCourseCard> Cards, List<SessionSummary> Sessions)> BuildLiveAsync(CurrentUser user, CancellationToken ct)
    {
        var mine = await GetMyEventsAsync(user, ct);
        if (mine.Count == 0) return ([], []);
        var events = await ReadEventsAsync(mine.Keys, ct);
        var tracks = await ReadTracksAsync(mine.Keys.ToArray(), ct);
        var docCounts = await CountDocumentsAsync(tracks.Select(t => t.Id()), ct);

        var cards = new List<LiveCourseCard>();
        var allSessions = new List<SessionSummary>();
        foreach (var (eventId, access) in mine)
        {
            if (!events.TryGetValue(eventId, out var ev)) continue;
            var title = CleanTitle(ev.Str("name") ?? "");
            var sessions = tracks.Where(t => t.M2O("event_id")?.Id == eventId)
                .Select((t, i) => ToSession(t, title, i + 1, !access.Expired, docCounts)).ToList();
            cards.Add(ToCard(ev, access, sessions));
            if (!access.Expired) allSessions.AddRange(sessions);
        }

        cards = cards
            .OrderBy(c => c.Expired)
            .ThenBy(c => c.NextSession is null)
            .ThenBy(c => c.NextSession?.Start ?? DateTime.MaxValue)
            .ThenByDescending(c => c.Start)
            .ToList();
        return (cards, allSessions);
    }

    public async Task<IReadOnlyList<LiveCourseCard>> GetLiveCoursesAsync(CurrentUser user, CancellationToken ct) =>
        (await BuildLiveAsync(user, ct)).Cards;

    public async Task<Result<LiveCourseDetail>> GetLiveCourseAsync(CurrentUser user, int eventId, CancellationToken ct)
    {
        var access = await RequireEventAsync(user, eventId, needContent: false, ct);
        if (!access.IsSuccess) return access.Error!;
        var ev = (await ReadEventsAsync([eventId], ct))[eventId];
        var title = CleanTitle(ev.Str("name") ?? "");
        var tracks = await ReadTracksAsync([eventId], ct);
        var docCounts = await CountDocumentsAsync(tracks.Select(t => t.Id()), ct);
        var sessions = tracks.Select((t, i) => ToSession(t, title, i + 1, !access.Value!.Expired, docCounts)).ToList();
        var days = await WeekDaysAsync(ev.Ids("week_day_ids"), ct);
        return new LiveCourseDetail(ToCard(ev, access.Value!, sessions), ev.Str("date_tz") ?? "Asia/Riyadh", days, sessions);
    }

    private async Task<string[]> WeekDaysAsync(int[] ids, CancellationToken ct)
    {
        if (ids.Length == 0) return [];
        var all = (await cache.GetOrCreateAsync("week-days", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(12);
            var rows = await odoo.SearchReadAsync("week.day", [], ["name"], ct: ct);
            return rows.ToDictionary(r => r.Id(), r => (r.Str("name") ?? "").ToLowerInvariant());
        }))!;
        return ids.Where(all.ContainsKey).Select(i => all[i]).ToArray();
    }

    private async Task<Result<(JsonElement Track, EventAccess Access, string EventTitle)>> RequireTrackAsync(CurrentUser user, int trackId, CancellationToken ct)
    {
        var rows = await odoo.ReadAsync("event.track", [trackId], TrackFields, ct);
        if (rows.Count == 0 || rows[0].M2O("event_id") is not { } ev)
            return Error.NotFound("session_not_found", "هذه المحاضرة غير موجودة.");
        var access = await RequireEventAsync(user, ev.Id, needContent: true, ct);
        if (!access.IsSuccess) return access.Error!;
        var stage = rows[0].M2O("stage_id")?.Name;
        if (stage is not null && options.Value.HiddenSessionStages.Contains(stage, StringComparer.OrdinalIgnoreCase))
            return Error.NotFound("session_not_found", "هذه المحاضرة غير موجودة.");
        return (rows[0], access.Value!, CleanTitle(ev.Name));
    }

    public async Task<Result<SessionDetail>> GetSessionAsync(CurrentUser user, int trackId, CancellationToken ct)
    {
        var found = await RequireTrackAsync(user, trackId, ct);
        if (!found.IsSuccess) return found.Error!;
        var (track, _, eventTitle) = found.Value;

        var eventId = track.M2O("event_id")!.Value.Id;
        var all = await ReadTracksAsync([eventId], ct);
        var number = all.FindIndex(t => t.Id() == trackId) + 1;
        var docs = await odoo.SearchReadAsync("event.track.document", D(("track_id", "=", trackId), ("source", "=", "manual")),
            ["name", "file_extension", "bunny_file_size_display", "bunny_original_filename", "bunny_storage_path"], order: "sequence asc, id asc", ct: ct);
        var documents = docs.Select(d => new SessionDocument(d.Id(), DocumentName(d), Extension(d), d.Str("bunny_file_size_display"))).ToList();
        var summary = ToSession(track, eventTitle, Math.Max(number, 1), true, new Dictionary<int, int> { [trackId] = documents.Count });
        var raw = track.Str("bunny_video_url");
        // Bunny refuses unsigned embeds, so without the signing key we point to the website instead of a broken player.
        var signable = !string.IsNullOrEmpty(raw) && bunny.CanSign;
        return new SessionDetail(summary, signable ? bunny.Sign(raw) : null, !string.IsNullOrEmpty(raw) && !bunny.CanSign,
            $"{Website}/my/events", documents);
    }

    public async Task<Result<JoinLink>> GetJoinLinkAsync(CurrentUser user, int trackId, CancellationToken ct)
    {
        var found = await RequireTrackAsync(user, trackId, ct);
        if (!found.IsSuccess) return found.Error!;
        var (track, _, eventTitle) = found.Value;
        var s = ToSession(track, eventTitle, 1, true, new Dictionary<int, int>());
        if (s.Status == SessionStatus.Ended) return Error.Blocked("session_ended", "انتهت هذه المحاضرة، وسيظهر التسجيل فور جاهزيته.");
        if (s.Status == SessionStatus.Cancelled) return Error.Blocked("session_cancelled", "أُلغيت هذه المحاضرة.");
        if (!s.CanJoin)
            return Error.Blocked("not_open_yet", $"يُتاح رابط الدخول قبل المحاضرة بـ {options.Value.JoinOpensMinutesBefore} دقيقة.");
        return new JoinLink(track.Str("active_join_live_url")!);
    }

    public async Task<Result<string>> GetDocumentUrlAsync(CurrentUser user, int documentId, CancellationToken ct)
    {
        var rows = await odoo.ReadAsync("event.track.document", [documentId], ["track_id", "source"], ct);
        if (rows.Count == 0 || rows[0].Str("source") != "manual" || rows[0].M2O("track_id") is not { } track)
            return Error.NotFound("file_not_found", "هذا الملف غير موجود.");
        var found = await RequireTrackAsync(user, track.Id, ct);
        if (!found.IsSuccess) return found.Error!;
        // bunny_signed_url is computed by Odoo at read time with a short expiry, so we read it only after the access check.
        var signed = (await odoo.ReadAsync("event.track.document", [documentId], ["bunny_signed_url"], ct)).FirstOrDefault().Str("bunny_signed_url");
        return string.IsNullOrEmpty(signed) ? Error.NotFound("file_not_found", "هذا الملف غير متاح حاليًا.") : signed;
    }

    // ------------------------------------------------------------------ recorded courses

    private async Task<Dictionary<int, JsonElement>> ReadChannelsAsync(IEnumerable<int> ids, CancellationToken ct)
    {
        var result = new Dictionary<int, JsonElement>();
        var missing = new List<int>();
        foreach (var id in ids.Distinct())
        {
            if (cache.TryGetValue($"channel:{id}", out JsonElement e)) result[id] = e;
            else missing.Add(id);
        }
        foreach (var e in await odoo.ReadAsync("slide.channel", missing, ["name", "description_short", "total_slides", "total_time"], ct))
        {
            cache.Set($"channel:{e.Id()}", e, TimeSpan.FromMinutes(10));
            result[e.Id()] = e;
        }
        return result;
    }

    private static RecordedCourseCard ToCard(JsonElement ch, Enrollment e, int? nextLesson) =>
        new(ch.Id(), (ch.Str("name") ?? "").Trim(), StripHtml(ch.Str("description_short")), Math.Round(e.Completion, 1), e.Status,
            ch.Int("total_slides") ?? 0, Math.Round(ch.Dbl("total_time"), 1), e.AccessUntil, e.Expired, e.FromEvent, nextLesson);

    public async Task<IReadOnlyList<RecordedCourseCard>> GetRecordedCoursesAsync(CurrentUser user, CancellationToken ct)
    {
        var mine = await GetMyEnrollmentsAsync(user, ct);
        var channels = await ReadChannelsAsync(mine.Keys, ct);
        return mine.Values.Where(e => channels.ContainsKey(e.ChannelId))
            .Select(e => ToCard(channels[e.ChannelId], e, null))
            .OrderBy(c => c.Expired)
            .ThenBy(c => c.Completion is > 0 and < 100 ? 0 : c.Completion == 0 ? 1 : 2)
            .ThenByDescending(c => c.Completion)
            .ToList();
    }

    private sealed record Outline(List<JsonElement> Slides);

    private async Task<Outline> ReadOutlineAsync(int channelId, CancellationToken ct) =>
        (await cache.GetOrCreateAsync($"outline:{channelId}", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
            var slides = await odoo.SearchReadAsync("slide.slide", D(("channel_id", "=", channelId), ("is_published", "=", true)),
                ["name", "slide_category", "is_category", "completion_time", "is_preview", "sequence"], order: "sequence asc, id asc", ct: ct);
            return new Outline(slides);
        }))!;

    private async Task<HashSet<int>> CompletedSlidesAsync(CurrentUser user, int channelId, CancellationToken ct)
    {
        var rows = await odoo.SearchReadAsync("slide.slide.partner",
            D(("partner_id", "=", user.PartnerId), ("channel_id", "=", channelId), ("completed", "=", true)), ["slide_id"], ct: ct);
        return rows.Select(r => r.M2O("slide_id")?.Id ?? 0).ToHashSet();
    }

    public async Task<Result<RecordedCourseDetail>> GetRecordedCourseAsync(CurrentUser user, int channelId, CancellationToken ct)
    {
        var enrollment = await RequireChannelAsync(user, channelId, needContent: false, ct);
        if (!enrollment.IsSuccess) return enrollment.Error!;
        var ch = (await ReadChannelsAsync([channelId], ct))[channelId];
        var outline = await ReadOutlineAsync(channelId, ct);
        var done = await CompletedSlidesAsync(user, channelId, ct);

        var sections = new List<LessonSection>();
        var current = new List<LessonItem>();
        int? sectionId = null;
        var sectionTitle = "";
        foreach (var s in outline.Slides)
        {
            if (s.Bool("is_category"))
            {
                if (current.Count > 0 || sectionId is not null) sections.Add(new LessonSection(sectionId, sectionTitle, current));
                current = [];
                sectionId = s.Id();
                sectionTitle = (s.Str("name") ?? "").Trim();
                continue;
            }
            current.Add(new LessonItem(s.Id(), (s.Str("name") ?? "").Trim(), s.Str("slide_category") ?? "document",
                Math.Round(s.Dbl("completion_time") * 60), done.Contains(s.Id()), s.Bool("is_preview")));
        }
        if (current.Count > 0 || sectionId is not null) sections.Add(new LessonSection(sectionId, sectionTitle, current));
        sections = sections.Where(x => x.Lessons.Count > 0).ToList();

        var next = sections.SelectMany(x => x.Lessons).FirstOrDefault(l => !l.Completed)?.Id;
        return new RecordedCourseDetail(ToCard(ch, enrollment.Value!, next), StripHtml(ch.Str("description_short")), sections);
    }

    public async Task<Result<LessonDetail>> GetLessonAsync(CurrentUser user, int slideId, CancellationToken ct)
    {
        var rows = await odoo.ReadAsync("slide.slide", [slideId],
            ["name", "channel_id", "slide_category", "is_category", "completion_time", "is_preview", "is_published", "website_url"], ct);
        if (rows.Count == 0 || rows[0].Bool("is_category") || !rows[0].Bool("is_published") || rows[0].M2O("channel_id") is not { } ch)
            return Error.NotFound("lesson_not_found", "هذا الدرس غير موجود.");
        var s = rows[0];
        var access = await RequireChannelAsync(user, ch.Id, needContent: !s.Bool("is_preview"), ct);
        if (!access.IsSuccess) return access.Error!;

        var type = s.Str("slide_category") ?? "document";
        string? video = null, html = null, docUrl = null;
        var hasFile = false;
        switch (type)
        {
            case "video":
                var v = await odoo.ReadAsync("slide.slide", [slideId], ["embed_code"], ct);
                video = BunnySigner.SrcFromEmbed(v.FirstOrDefault().Str("embed_code"));
                break;
            case "article":
                html = (await odoo.ReadAsync("slide.slide", [slideId], ["html_content"], ct)).FirstOrDefault().Str("html_content");
                break;
            case "document":
            case "infographic":
                var d = await odoo.ReadAsync("slide.slide", [slideId], ["url", "source_type"], ct);
                docUrl = d.FirstOrDefault().Str("url");
                hasFile = string.IsNullOrEmpty(docUrl);
                break;
        }

        var outline = await ReadOutlineAsync(ch.Id, ct);
        var lessons = outline.Slides.Where(x => !x.Bool("is_category")).Select(x => x.Id()).ToList();
        var idx = lessons.IndexOf(slideId);
        var done = await CompletedSlidesAsync(user, ch.Id, ct);
        var site = s.Str("website_url");
        return new LessonDetail(slideId, ch.Id, (s.Str("name") ?? "").Trim(), type, Math.Round(s.Dbl("completion_time") * 60),
            done.Contains(slideId), video, html, docUrl, hasFile, site is null ? null : Website + site,
            idx > 0 ? lessons[idx - 1] : null, idx >= 0 && idx < lessons.Count - 1 ? lessons[idx + 1] : null);
    }

    public async Task<Result<(byte[] Bytes, string ContentType, string FileName)>> GetLessonFileAsync(CurrentUser user, int slideId, CancellationToken ct)
    {
        var lesson = await GetLessonAsync(user, slideId, ct);
        if (!lesson.IsSuccess) return lesson.Error!;
        if (!lesson.Value!.HasFile) return Error.NotFound("file_not_found", "لا يوجد ملف لهذا الدرس.");
        var field = lesson.Value.Type == "infographic" ? "image_1920" : "binary_content";
        var data = (await odoo.ReadAsync("slide.slide", [slideId], [field], ct)).FirstOrDefault().Str(field);
        if (string.IsNullOrEmpty(data)) return Error.NotFound("file_not_found", "هذا الملف غير متاح حاليًا.");
        var bytes = Convert.FromBase64String(data);
        var type = Media.Sniff(bytes);
        return (bytes, type, $"{Slug(lesson.Value.Title)}{Media.Extension(type)}");
    }

    public async Task<Result<bool>> CompleteLessonAsync(CurrentUser user, int slideId, CancellationToken ct)
    {
        var lesson = await GetLessonAsync(user, slideId, ct);
        if (!lesson.IsSuccess) return lesson.Error!;
        if (lesson.Value!.Type is "quiz" or "certification")
            return Error.Blocked("quiz_on_website", "يُجرى هذا الاختبار على موقع إنجوسوفت.");
        var access = await RequireChannelAsync(user, lesson.Value.ChannelId, needContent: true, ct);
        if (!access.IsSuccess) return access.Error!;

        var existing = await odoo.SearchReadAsync("slide.slide.partner",
            D(("slide_id", "=", slideId), ("partner_id", "=", user.PartnerId)), ["completed"], limit: 1, ct: ct);
        if (existing.Count > 0)
        {
            if (!existing[0].Bool("completed"))
                await odoo.WriteAsync("slide.slide.partner", [existing[0].Id()], new() { ["completed"] = true }, ct);
        }
        else
        {
            await odoo.CreateAsync("slide.slide.partner", new()
            {
                ["slide_id"] = slideId, ["partner_id"] = user.PartnerId, ["channel_id"] = lesson.Value.ChannelId, ["completed"] = true,
            }, ct);
        }
        cache.Remove($"my-courses:{user.PartnerId}");
        return true;
    }

    // ------------------------------------------------------------------ lesson quizzes (Odoo slide.question)

    private async Task<Result<(LessonDetail Lesson, List<System.Text.Json.JsonElement> Questions, Dictionary<int, List<System.Text.Json.JsonElement>> Answers)>> LoadQuizAsync(
        CurrentUser user, int slideId, CancellationToken ct)
    {
        var lesson = await GetLessonAsync(user, slideId, ct);
        if (!lesson.IsSuccess) return lesson.Error!;
        if (lesson.Value!.Type != "quiz") return Error.Validation("not_quiz", "هذا الدرس ليس اختبارًا.");
        var access = await RequireChannelAsync(user, lesson.Value.ChannelId, needContent: true, ct);
        if (!access.IsSuccess) return access.Error!;
        var questions = await odoo.SearchReadAsync("slide.question", D(("slide_id", "=", slideId)), ["question", "answer_ids"], order: "sequence asc, id asc", ct: ct);
        var answers = await odoo.ReadAsync("slide.answer", questions.SelectMany(q => q.Ids("answer_ids")), ["text_value", "is_correct", "comment", "question_id", "sequence"], ct);
        var byQuestion = answers.GroupBy(a => a.M2O("question_id")!.Value.Id)
            .ToDictionary(g => g.Key, g => g.OrderBy(a => a.Int("sequence") ?? 0).ThenBy(a => a.Id()).ToList());
        return (lesson.Value, questions, byQuestion);
    }

    private async Task<System.Text.Json.JsonElement?> SlidePartnerAsync(CurrentUser user, int slideId, CancellationToken ct) =>
        (await odoo.SearchReadAsync("slide.slide.partner", D(("slide_id", "=", slideId), ("partner_id", "=", user.PartnerId)),
            ["completed", "quiz_attempts_count"], limit: 1, ct: ct)).Cast<System.Text.Json.JsonElement?>().FirstOrDefault();

    /// <summary>The questions without which answer is right; grading happens on the server.</summary>
    public async Task<Result<LessonQuiz>> GetLessonQuizAsync(CurrentUser user, int slideId, CancellationToken ct)
    {
        var loaded = await LoadQuizAsync(user, slideId, ct);
        if (!loaded.IsSuccess) return loaded.Error!;
        var (lesson, questions, answers) = loaded.Value;
        var sp = await SlidePartnerAsync(user, slideId, ct);
        return new LessonQuiz(slideId, lesson.ChannelId, lesson.Title, sp?.Bool("completed") ?? false, sp?.Int("quiz_attempts_count") ?? 0,
            questions.Select(q => new LessonQuizQuestion(q.Id(), q.Str("question") ?? "",
                answers.GetValueOrDefault(q.Id(), []).Select(a => new LessonQuizAnswer(a.Id(), a.Str("text_value") ?? "")).ToList())).ToList());
    }

    /// <summary>Grades like the website does: the quiz counts as done only when every answer is right; each try is an attempt.</summary>
    public async Task<Result<LessonQuizResult>> SubmitLessonQuizAsync(CurrentUser user, int slideId, LessonQuizSubmit req, CancellationToken ct)
    {
        var loaded = await LoadQuizAsync(user, slideId, ct);
        if (!loaded.IsSuccess) return loaded.Error!;
        var (lesson, questions, answers) = loaded.Value;
        var results = new List<LessonQuizQuestionResult>();
        foreach (var q in questions)
        {
            var options = answers.GetValueOrDefault(q.Id(), []);
            int? chosen = req.Answers?.TryGetValue(q.Id(), out var c) == true && options.Any(a => a.Id() == c) ? c : null;
            var picked = options.FirstOrDefault(a => a.Id() == chosen);
            var ok = chosen is not null && picked.Bool("is_correct");
            results.Add(new LessonQuizQuestionResult(q.Id(), chosen, ok, chosen is null ? null : picked.Str("comment")));
        }
        var correct = results.Count(r => r.IsCorrect);
        var allRight = results.Count > 0 && correct == results.Count;

        var sp = await SlidePartnerAsync(user, slideId, ct);
        var attempts = (sp?.Int("quiz_attempts_count") ?? 0) + 1;
        var alreadyDone = sp?.Bool("completed") ?? false;
        var values = new Dictionary<string, object?> { ["quiz_attempts_count"] = attempts };
        if (allRight) values["completed"] = true;
        if (sp is { } existing) await odoo.WriteAsync("slide.slide.partner", [existing.Id()], values, ct);
        else
        {
            values["slide_id"] = slideId; values["partner_id"] = user.PartnerId; values["channel_id"] = lesson.ChannelId;
            await odoo.CreateAsync("slide.slide.partner", values, ct);
        }
        cache.Remove($"my-courses:{user.PartnerId}");
        return new LessonQuizResult(allRight || alreadyDone, correct, results.Count, attempts, results);
    }

    // ------------------------------------------------------------------ certificates & profile

    public async Task<IReadOnlyList<CertificateDto>> GetCertificatesAsync(CurrentUser user, CancellationToken ct)
    {
        var rows = await odoo.SearchReadAsync("lms.certificate",
            D(("partner_id", "=", user.PartnerId), ("state", "in", new[] { "generated", "sent" })),
            ["certificate_type", "course_id", "event_id", "manual_course_name", "certificate_number", "issue_date", "completion_percentage"],
            order: "issue_date desc", ct: ct);
        return rows.Select(r => new CertificateDto(r.Id(),
            CleanTitle(r.M2O("course_id")?.Name ?? r.M2O("event_id")?.Name ?? r.Str("manual_course_name") ?? "شهادة إنجوسوفت"),
            r.Str("certificate_type") ?? "recorded", r.Str("certificate_number"), r.Utc("issue_date"),
            r.Dbl("completion_percentage") is > 0 and var p ? Math.Round(p) : null)).ToList();
    }

    public async Task<Result<(byte[] Bytes, string ContentType, string FileName)>> GetCertificateImageAsync(CurrentUser user, int id, CancellationToken ct)
    {
        var rows = await odoo.ReadAsync("lms.certificate", [id], ["partner_id", "state", "certificate_filename"], ct);
        if (rows.Count == 0 || rows[0].M2O("partner_id")?.Id != user.PartnerId || rows[0].Str("state") is not ("generated" or "sent"))
            return Error.NotFound("certificate_not_found", "هذه الشهادة غير موجودة.");
        var data = (await odoo.ReadAsync("lms.certificate", [id], ["certificate_image"], ct)).FirstOrDefault().Str("certificate_image");
        if (string.IsNullOrEmpty(data)) return Error.NotFound("certificate_not_ready", "الشهادة قيد الإعداد.");
        var bytes = Convert.FromBase64String(data);
        return (bytes, Media.Sniff(bytes), rows[0].Str("certificate_filename") ?? $"certificate-{id}.png");
    }

    public async Task<ProfileDto> GetProfileAsync(CurrentUser user, CancellationToken ct)
    {
        var p = (await odoo.ReadAsync("res.partner", [user.PartnerId], ["name", "name_ar", "email", "phone"], ct)).First();
        return new ProfileDto(user.PartnerId, p.Str("name") ?? user.Name, p.Str("name_ar"), p.Str("email"), p.Str("phone"),
            user.Kind.ToString().ToLowerInvariant(), Website);
    }

    public async Task<HomeDto> GetHomeAsync(CurrentUser user, int unreadNotifications, int unreadMessages, CancellationToken ct)
    {
        var liveTask = BuildLiveAsync(user, ct);
        var recordedTask = GetRecordedCoursesAsync(user, ct);
        var certTask = odoo.SearchCountAsync("lms.certificate", D(("partner_id", "=", user.PartnerId), ("state", "in", new[] { "generated", "sent" })), ct);
        await Task.WhenAll(liveTask, recordedTask, certTask);

        var (cards, sessions) = liveTask.Result;
        var upcoming = sessions.Where(s => s.Status is SessionStatus.Live or SessionStatus.Upcoming).OrderBy(s => s.Start).ToList();
        // The app groups these by the learner's own local day.
        var horizon = Now.AddDays(14);
        var soon = upcoming.Where(s => s.Start < horizon).Take(12).ToList();
        var continueLearning = recordedTask.Result.Where(c => !c.Expired && c.Completion < 100).Take(8).ToList();
        return new HomeDto(user.Name, upcoming.FirstOrDefault(), soon, cards.Where(c => !c.Expired).Take(10).ToList(),
            continueLearning, certTask.Result, unreadNotifications, unreadMessages, Website);
    }

    public string WebsiteUrl => Website;

    // ------------------------------------------------------------------ helpers

    [GeneratedRegex(@"\s*-\s*\d{3,6}\s*$")]
    private static partial Regex TrailingCode();

    [GeneratedRegex(@"^\(E\d+\)\s*")]
    private static partial Regex LeadingCode();

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex Tags();

    /// <summary>"(E05887) Light Current - 5687 " becomes "Light Current"; the code is shown separately.</summary>
    public static string CleanTitle(string name) => TrailingCode().Replace(LeadingCode().Replace(name.Trim(), ""), "").Trim();

    private static string? StripHtml(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return null;
        var text = System.Net.WebUtility.HtmlDecode(Tags().Replace(html, " "));
        text = Regex.Replace(text, @"\s+", " ").Trim();
        return text.Length == 0 ? null : text;
    }

    private static string DocumentName(JsonElement d)
    {
        var original = d.Str("bunny_original_filename");
        if (!string.IsNullOrWhiteSpace(original)) return original;
        var path = d.Str("bunny_storage_path");
        if (!string.IsNullOrWhiteSpace(path)) return Path.GetFileName(path).Replace('_', ' ');
        return d.Str("name") ?? "ملف";
    }

    private static string? Extension(JsonElement d)
    {
        var ext = d.Str("file_extension");
        if (!string.IsNullOrWhiteSpace(ext)) return ext.TrimStart('.').ToLowerInvariant();
        var name = d.Str("bunny_original_filename") ?? d.Str("bunny_storage_path");
        var e = Path.GetExtension(name ?? "");
        return string.IsNullOrEmpty(e) ? null : e.TrimStart('.').ToLowerInvariant();
    }

    private static string Slug(string s) =>
        string.Concat(s.Select(c => char.IsLetterOrDigit(c) ? c : '-')).Trim('-') is { Length: > 0 } x ? x : "lesson";
}

public static class Media
{
    public static string Sniff(byte[] b)
    {
        if (b.Length >= 4 && b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46) return "application/pdf";
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b.Length >= 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 && b[8] == 0x57 && b[9] == 0x45) return "image/webp";
        if (b.Length >= 4 && b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return "image/gif";
        if (b.Length >= 4 && b[0] == 0x50 && b[1] == 0x4B) return "application/zip";
        var head = System.Text.Encoding.UTF8.GetString(b, 0, Math.Min(b.Length, 256)).TrimStart();
        if (head.StartsWith("<svg") || head.StartsWith("<?xml")) return "image/svg+xml";
        return "application/octet-stream";
    }

    public static string Extension(string contentType) => contentType switch
    {
        "application/pdf" => ".pdf",
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/svg+xml" => ".svg",
        "application/zip" => ".zip",
        _ => "",
    };
}
