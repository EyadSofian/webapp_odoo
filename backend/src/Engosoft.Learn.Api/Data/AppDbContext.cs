using Engosoft.Learn.Api.Assessments;
using Microsoft.EntityFrameworkCore;

namespace Engosoft.Learn.Api.Data;

/// <summary>
/// The app's own store: chat, notifications and sessions. Learning data (courses, sessions, enrollments)
/// stays in Odoo and is never copied here beyond what chat membership needs.
/// </summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<ChatRoom> Rooms => Set<ChatRoom>();
    public DbSet<RoomMember> Members => Set<RoomMember>();
    public DbSet<ChatMessage> Messages => Set<ChatMessage>();
    public DbSet<MessageReaction> Reactions => Set<MessageReaction>();
    public DbSet<MessageReport> Reports => Set<MessageReport>();
    public DbSet<ChatAttachment> Attachments => Set<ChatAttachment>();
    public DbSet<ChatAudit> Audit => Set<ChatAudit>();
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<UserPreference> Preferences => Set<UserPreference>();
    public DbSet<SentReminder> SentReminders => Set<SentReminder>();
    public DbSet<AppSetting> Settings => Set<AppSetting>();
    public DbSet<Assessment> Assessments => Set<Assessment>();
    public DbSet<AssessmentQuestion> Questions => Set<AssessmentQuestion>();
    public DbSet<AssessmentOption> Options => Set<AssessmentOption>();
    public DbSet<QuizAttempt> QuizAttempts => Set<QuizAttempt>();
    public DbSet<TaskSubmission> TaskSubmissions => Set<TaskSubmission>();
    public DbSet<SubmissionFile> SubmissionFiles => Set<SubmissionFile>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<RefreshToken>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.PartnerId);
            e.Property(x => x.TokenHash).HasMaxLength(128);
            e.Property(x => x.Name).HasMaxLength(256);
            e.Property(x => x.Kind).HasMaxLength(32);
            e.Property(x => x.UserAgent).HasMaxLength(512);
        });

        b.Entity<ChatRoom>(e =>
        {
            e.HasIndex(x => new { x.Kind, x.OdooEventId, x.OwnerPartnerId });
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Title).HasMaxLength(512);
            e.Property(x => x.Code).HasMaxLength(64);
            e.HasMany(x => x.Members).WithOne(m => m.Room).HasForeignKey(m => m.RoomId);
        });

        b.Entity<RoomMember>(e =>
        {
            e.HasKey(x => new { x.RoomId, x.PartnerId });
            e.HasIndex(x => x.PartnerId);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Notify).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.DisplayName).HasMaxLength(256);
            e.Property(x => x.RemovedReason).HasMaxLength(64);
        });

        b.Entity<ChatMessage>(e =>
        {
            e.HasIndex(x => new { x.RoomId, x.Id });
            e.Property(x => x.Body).HasMaxLength(4000);
            e.Property(x => x.SenderName).HasMaxLength(256);
            e.Property(x => x.SenderRole).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.AttachmentIds).HasMaxLength(1024);
            e.HasMany(x => x.Reactions).WithOne().HasForeignKey(r => r.MessageId);
        });

        b.Entity<MessageReaction>(e =>
        {
            e.HasKey(x => new { x.MessageId, x.PartnerId, x.Emoji });
            e.Property(x => x.Emoji).HasMaxLength(16);
        });

        b.Entity<MessageReport>(e => e.Property(x => x.Reason).HasMaxLength(500));

        b.Entity<ChatAttachment>(e =>
        {
            e.Property(x => x.FileName).HasMaxLength(256);
            e.Property(x => x.ContentType).HasMaxLength(128);
            e.Property(x => x.Sha256).HasMaxLength(64);
            e.Property(x => x.StoragePath).HasMaxLength(512);
        });

        b.Entity<ChatAudit>(e =>
        {
            e.HasIndex(x => new { x.RoomId, x.At });
            e.Property(x => x.Action).HasMaxLength(64);
            e.Property(x => x.Details).HasMaxLength(1000);
        });

        b.Entity<PushSubscription>(e =>
        {
            e.HasIndex(x => x.Endpoint).IsUnique();
            e.HasIndex(x => x.PartnerId);
            e.Property(x => x.Endpoint).HasMaxLength(1024);
            e.Property(x => x.P256dh).HasMaxLength(256);
            e.Property(x => x.Auth).HasMaxLength(128);
            e.Property(x => x.UserAgent).HasMaxLength(512);
        });

        b.Entity<Notification>(e =>
        {
            e.HasIndex(x => new { x.PartnerId, x.Id });
            e.Property(x => x.Kind).HasMaxLength(32);
            e.Property(x => x.Title).HasMaxLength(256);
            e.Property(x => x.Body).HasMaxLength(1000);
            e.Property(x => x.Url).HasMaxLength(512);
        });

        b.Entity<UserPreference>(e =>
        {
            e.HasKey(x => x.PartnerId);
            e.Property(x => x.TimeZone).HasMaxLength(64);
        });

        b.Entity<SentReminder>(e =>
        {
            e.HasKey(x => new { x.TrackId, x.Kind });
            e.Property(x => x.Kind).HasMaxLength(16);
        });

        b.Entity<Assessment>(e =>
        {
            e.HasIndex(x => new { x.OdooEventId, x.Status });
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Instructions).HasMaxLength(4000);
            e.HasMany(x => x.Questions).WithOne().HasForeignKey(q => q.AssessmentId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<AssessmentQuestion>(e =>
        {
            e.Property(x => x.Text).HasMaxLength(2000);
            e.Property(x => x.Explanation).HasMaxLength(2000);
            e.HasMany(x => x.Options).WithOne().HasForeignKey(o => o.QuestionId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<AssessmentOption>(e => e.Property(x => x.Text).HasMaxLength(1000));
        b.Entity<QuizAttempt>(e =>
        {
            e.HasIndex(x => new { x.AssessmentId, x.PartnerId });
            e.Property(x => x.PartnerName).HasMaxLength(256);
            e.Property(x => x.Answers).HasMaxLength(8000);
        });
        b.Entity<TaskSubmission>(e =>
        {
            e.HasIndex(x => new { x.AssessmentId, x.PartnerId }).IsUnique();
            e.Property(x => x.PartnerName).HasMaxLength(256);
            e.Property(x => x.Text).HasMaxLength(8000);
            e.Property(x => x.Feedback).HasMaxLength(4000);
            e.HasMany(x => x.Files).WithOne().HasForeignKey(f => f.SubmissionId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SubmissionFile>(e =>
        {
            e.Property(x => x.FileName).HasMaxLength(256);
            e.Property(x => x.ContentType).HasMaxLength(128);
            e.Property(x => x.StoragePath).HasMaxLength(512);
        });

        b.Entity<AppSetting>(e =>
        {
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasMaxLength(64);
            e.Property(x => x.Value).HasMaxLength(2048);
        });
    }
}
