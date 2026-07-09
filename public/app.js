const state = {
  tab: "actions",
  lang: loadLanguage(),
  connection: loadConnection(),
  agents: [],
  teams: [],
  inboxes: [],
  metrics: null,
  preview: null,
  phonePreview: null,
  phoneParse: null,
  loadingAction: "",
  openReport: null,
  analytics: null,
  analyticsFilters: { since: "", until: "", inboxId: "" },
  jobs: [],
  audit: [],
  campaigns: [],
  webhooks: [],
  automationSettings: defaultClientAutomationSettings(),
  automationSettingsMeta: { saved: false, updatedAt: null },
  appContext: null,
  bulkCriteria: {
    scope: "conversations",
    status: "open",
    inboxId: "",
    action: "assign_agent",
    ownerAttribute: "sales_owner_id",
    unreadOnly: false,
    maxPages: 20
  },
  openReportCriteria: {
    inboxIds: [],
    agentIds: [],
    unreadOnly: false,
    includeReplyStatus: false,
    needsReplyOnly: false,
    replyCheckLimit: 100,
    maxPages: 20
  },
  phoneAssign: {
    rawText: "",
    fileName: "",
    fileBase64: "",
    status: "open",
    inboxId: "",
    targetAgentId: "",
    maxPhones: 100
  }
};

const translations = {
  ar: {
    "Actions": "الإجراءات",
    "Dashboard": "لوحة المتابعة",
    "Analytics": "التحليلات",
    "Lead sources, CSAT, and per-agent / per-team response times.": "مصادر العملاء والتقييمات وأزمنة رد كل موظف/تيم.",
    "Lead sources and satisfaction come from this app's durable log; agent and team timings come live from Chatwoot reporting.": "مصادر العملاء والتقييمات بتتسجل في سجل دائم جوه التطبيق؛ وأزمنة رد الموظفين والتيمات بتيجي مباشرة من تقارير Chatwoot.",
    "From date": "من تاريخ",
    "To date": "إلى تاريخ",
    "Leave the dates empty to report on the last 30 days.": "سيب التواريخ فاضية عشان التقرير يشمل آخر 30 يوم.",
    "Run analytics": "شغّل التحليلات",
    "Download analytics CSV": "تحميل التحليلات CSV",
    "No analytics to download.": "لا يوجد تحليلات للتحميل.",
    "Analytics CSV downloaded.": "تم تحميل ملف التحليلات CSV.",
    "Customers surveyed": "عملاء قيّموا",
    "Average rating": "متوسط التقييم",
    "Total leads": "إجمالي العملاء",
    "Rating distribution": "توزيع التقييمات",
    "Leads by source": "العملاء حسب المصدر",
    "Per-agent satisfaction & response": "رضا واستجابة كل موظف",
    "Per-team performance": "أداء كل تيم",
    "rating": "التقييم",
    "count": "العدد",
    "share": "النسبة",
    "teamName": "التيم",
    "ratedCount": "عدد التقييمات",
    "averageRating": "متوسط التقييم",
    "conversationsCount": "عدد المحادثات",
    "resolutionsCount": "عدد الحلول",
    "avgFirstResponseTime": "متوسط أول رد",
    "avgResolutionTime": "متوسط زمن الحل",
    "Open Report": "تقرير المفتوح",
    "Phone Assign": "تعيين بالأرقام",
    "Campaigns": "الحملات",
    "Logs": "السجل",
    "Exports": "التصدير",
    "Setup": "الإعداد",
    "Run bulk transfers safely in three steps: choose, preview, execute.": "نفذ التحويلات الجماعية بأمان في ثلاث خطوات: اختار، راجع، نفذ.",
    "Counters, report snapshots, and Chatwoot embedded context.": "أرقام سريعة، تقارير، وسياق Chatwoot داخل التطبيق.",
    "Open conversations by inbox, unassigned queue, and selected agents.": "المحادثات المفتوحة حسب الإنبوكس، وغير المعيّن، والموظفين المختارين.",
    "Assign open conversations by uploaded or pasted phone numbers.": "عيّن المحادثات المفتوحة من ملف أرقام أو لصق مباشر.",
    "Track local campaigns and Chatwoot webhook reply signals.": "تابع الحملات المحلية وردود العملاء من Webhooks.",
    "Who did what, when, and which bulk job changed it.": "اعرف مين عمل إيه، إمتى، وأي عملية جماعية نفذتها.",
    "Download CSV files for audit logs, campaigns, and bulk jobs.": "حمل ملفات CSV للسجل والحملات والعمليات الجماعية.",
    "Connect this app to your self-hosted Chatwoot instance.": "اربط التطبيق بنسخة Chatwoot self-hosted.",
    "Transfer to agent": "تحويل لموظف",
    "Agent": "موظف",
    "Move all selected conversations from one sales/agent to another.": "انقل المحادثات المختارة من موظف أو سيلز لموظف آخر.",
    "Remove assignee": "إزالة التعيين",
    "Unassign": "بدون تعيين",
    "Take conversations away from an agent and return them to Unassigned.": "شيل المحادثات من الموظف ورجعها بدون تعيين.",
    "Move to team": "تحويل لفريق",
    "Team": "فريق",
    "Route a batch of conversations to a team queue.": "حول مجموعة محادثات إلى Queue فريق معين.",
    "Transfer customer owner": "تحويل مسؤول العميل",
    "Owner": "مسؤول",
    "Change the contact owner custom attribute, with optional conversation reassignment.": "غير مسؤول العميل في custom attribute مع إمكانية تحويل محادثاته.",
    "Quick actions": "إجراءات سريعة",
    "Pick the job you want. Nothing is changed until you preview and confirm.": "اختار العملية المطلوبة. مفيش أي تغيير بيحصل غير بعد المعاينة والتأكيد.",
    "Connected": "متصل",
    "Needs setup": "محتاج إعداد",
    "How it works": "طريقة العمل",
    "Choose action": "اختار الإجراء",
    "Select transfer, unassign, team routing, or contact owner transfer.": "اختار تحويل، إزالة تعيين، تحويل لفريق، أو تحويل مسؤول العميل.",
    "Preview": "معاينة",
    "The app asks Chatwoot for matching conversations/customers and shows the exact rows.": "التطبيق يجيب من Chatwoot العملاء أو المحادثات المطابقة ويعرضها قبل التنفيذ.",
    "Execute": "تنفيذ",
    "Only after confirmation, it calls Chatwoot assignment/contact APIs and logs every row.": "بعد التأكيد فقط، التطبيق ينفذ من خلال APIs ويسجل كل صف اتغير.",
    "For Chatwoot Dashboard App usage: add the Railway URL in Chatwoot Settings -> Integrations -> Dashboard Apps.": "لاستخدامه داخل Chatwoot: ضيف رابط Railway من Settings -> Integrations -> Dashboard Apps.",
    "Bulk action": "إجراء جماعي",
    "previewed": "تمت معاينتها",
    "Preview affected rows": "معاينة الصفوف المتأثرة",
    "Execute confirmed action": "تنفيذ الإجراء المؤكد",
    "Preview before execution": "المعاينة قبل التنفيذ",
    "Review the first 100 affected rows. Export full results after execution.": "راجع أول 100 صف متأثر. تقدر تصدر النتائج كاملة بعد التنفيذ.",
    "rows": "صف",
    "Open": "مفتوحة",
    "Unassigned": "غير معينة",
    "Unattended": "بدون متابعة",
    "Chatwoot Reports": "تقارير Chatwoot",
    "Load reports": "تحميل التقارير",
    "Dashboard App Context": "سياق Dashboard App",
    "Request context": "طلب السياق",
    "Create Local Campaign Tracker": "إنشاء متابعة حملة محلية",
    "Campaign name": "اسم الحملة",
    "May outbound": "حملة مايو",
    "Chatwoot campaign ID": "رقم حملة Chatwoot",
    "Owner / sales": "المسؤول / السيلز",
    "Audience note": "ملاحظة الجمهور",
    "VIP label": "عملاء VIP",
    "Create tracker": "إنشاء المتابعة",
    "Configure Chatwoot webhooks to call": "اضبط Chatwoot webhooks عشان تستدعي",
    "for message_created and message_updated events.": "لأحداث message_created و message_updated.",
    "Webhook Events": "أحداث Webhook",
    "Load events": "تحميل الأحداث",
    "Refresh": "تحديث",
    "Action Log": "سجل الإجراءات",
    "Fetch Chatwoot audit": "جلب Audit من Chatwoot",
    "CSV Downloads": "تحميل CSV",
    "Audit CSV": "سجل الإجراءات CSV",
    "Campaign CSV": "الحملات CSV",
    "Bulk jobs": "العمليات الجماعية",
    "Chatwoot connection": "اتصال Chatwoot",
    "These values can also live in Railway environment variables.": "القيم دي ممكن تتحط كمان في Environment Variables على Railway.",
    "Chatwoot base URL": "رابط Chatwoot الأساسي",
    "Account ID": "رقم الحساب",
    "User access token": "توكن المستخدم",
    "Operator name": "اسم المشغل",
    "Save and test": "حفظ وتجربة",
    "Clear local settings": "مسح الإعدادات المحلية",
    "Add it inside Chatwoot": "إضافته داخل Chatwoot",
    "Open Chatwoot": "افتح Chatwoot",
    "Go to Settings -> Integrations -> Dashboard Apps.": "ادخل Settings -> Integrations -> Dashboard Apps.",
    "Add app URL": "ضيف رابط التطبيق",
    "Paste your Railway public URL, then save.": "حط رابط Railway العام واعمل حفظ.",
    "Open any conversation": "افتح أي محادثة",
    "A new tab appears in the conversation panel and sends context to this app.": "هيظهر Tab جديد داخل المحادثة ويبعت السياق للتطبيق.",
    "Keep OPS_PASSWORD enabled on Railway. Chatwoot will ask for the same username/password the first time the embedded tab opens.": "خلي OPS_PASSWORD شغال على Railway. أول مرة التاب يفتح داخل Chatwoot هيطلب نفس اسم المستخدم وكلمة السر.",
    "Connected config": "الإعدادات متصلة",
    "Not connected": "غير متصل",
    "Save Chatwoot connection first.": "احفظ اتصال Chatwoot الأول.",
    "Connection saved locally.": "تم حفظ الاتصال محليًا.",
    "Requested Chatwoot dashboard context.": "تم طلب سياق Chatwoot.",
    "Fetched {count} Enterprise audit rows.": "تم جلب {count} سجل Audit من Enterprise.",
    "Bulk job finished: {succeeded}/{total} succeeded.": "انتهت العملية: {succeeded}/{total} تمت بنجاح.",
    "Execute {action} on {count} item(s)?": "تنفذ {action} على {count} عنصر؟",
    "Dashboard context": "سياق Chatwoot",
    "No embedded context received.": "لم يصل سياق من Chatwoot.",
    "Open this app as a Chatwoot Dashboard App to receive conversation, contact, and currentAgent context.": "افتح التطبيق كـ Dashboard App داخل Chatwoot عشان يستقبل بيانات المحادثة والعميل والموظف الحالي.",
    "Preview first. The app will show exactly which conversations/customers are affected before it writes anything.": "اعمل معاينة الأول. التطبيق هيعرض بالظبط المحادثات أو العملاء المتأثرين قبل أي تعديل.",
    "Running inside Chatwoot": "يعمل داخل Chatwoot",
    "Standalone mode": "وضع منفصل",
    "It works from Railway now. To make it feel native in Chatwoot, add this URL as a Dashboard App.": "التطبيق شغال من Railway حاليًا. عشان يبقى داخل Chatwoot، ضيف الرابط كـ Dashboard App.",
    "Refresh context": "تحديث السياق",
    "Setup guide": "شرح الإعداد",
    "1. Action": "1. الإجراء",
    "2. Filters": "2. الفلاتر",
    "3. Preview": "3. المعاينة",
    "4. Execute": "4. التنفيذ",
    "What should be changed?": "إيه اللي هيتغير؟",
    "Conversations": "المحادثات",
    "Customer owner field": "مسؤول العميل",
    "Conversation status": "حالة المحادثة",
    "Pending": "معلقة",
    "Resolved": "مغلقة",
    "Snoozed": "مؤجلة",
    "All": "الكل",
    "Current owner / from sales": "المسؤول الحالي / من سيلز",
    "Current assignee": "الموظف الحالي",
    "Inbox": "الإنبوكس",
    "All inboxes": "كل الإنبوكسات",
    "Action": "الإجراء",
    "Transfer owner": "تحويل المسؤول",
    "Remove owner": "إزالة المسؤول",
    "Remove assignee": "إزالة التعيين",
    "New owner / to sales": "المسؤول الجديد / إلى سيلز",
    "New assignee": "الموظف الجديد",
    "Target team": "الفريق المستهدف",
    "Owner custom attribute": "Custom attribute للمسؤول",
    "Search limit: Chatwoot API pages": "حد البحث: صفحات API من Chatwoot",
    "Chatwoot sends results in pages. 20 means scan up to 20 API pages, then stop for safety. This does not execute anything.": "Chatwoot بيرجع النتائج على صفحات. رقم 20 يعني التطبيق يفحص لحد 20 صفحة API ثم يتوقف للأمان. ده لا ينفذ أي تعديل.",
    "Conversation mode finds conversations assigned to the selected agent. Use this for moving chats from one employee to another.": "وضع المحادثات بيجيب المحادثات المعينة للموظف المختار. استخدمه لو عايز تنقل شاتات من موظف لموظف.",
    "Customer owner mode only finds contacts that already have this custom attribute. If you never filled sales_owner_id, preview can be zero.": "وضع مسؤول العميل بيجيب العملاء اللي عندهم الـ custom attribute ده بالفعل. لو sales_owner_id مش متسجل قبل كده، المعاينة ممكن تطلع صفر.",
    "No rows matched these filters. Try Status = All, remove the inbox filter, or confirm the current assignee/owner is correct.": "مفيش صفوف مطابقة للفلاتر دي. جرّب الحالة = الكل، أو شيل فلتر الإنبوكس، أو اتأكد إن الموظف/المسؤول الحالي صحيح.",
    "Open conversation report": "تقرير المحادثات المفتوحة",
    "This report does not change anything. It only reads open conversations from Chatwoot.": "التقرير ده لا يغير أي حاجة. هو يقرأ المحادثات المفتوحة فقط من Chatwoot.",
    "Choose inboxes": "اختار الإنبوكسات",
    "Choose agents": "اختار الموظفين",
    "Leave empty to include all.": "سيبها فاضية عشان يشمل الكل.",
    "Run open report": "تشغيل تقرير المفتوح",
    "Open conversations": "المحادثات المفتوحة",
    "Assigned conversations": "محادثات معيّنة",
    "Unassigned conversations": "محادثات غير معيّنة",
    "Unassigned by inbox": "غير المعيّن حسب الإنبوكس",
    "Open conversations without an assignee, grouped by inbox.": "المحادثات المفتوحة بدون موظف، مجمعة حسب الإنبوكس.",
    "Inbox summary": "ملخص الإنبوكسات",
    "Agent summary": "ملخص الموظفين",
    "Open conversation list": "قائمة المحادثات المفتوحة",
    "Run the report first.": "شغّل التقرير الأول.",
    "Assign from phone list": "تعيين من قائمة أرقام",
    "Paste numbers or upload CSV/XLSX, choose the employee, preview, then execute.": "الصق الأرقام أو ارفع CSV/XLSX، اختار الموظف، راجع، ثم نفذ.",
    "Target assignee": "الموظف المستهدف",
    "Phone numbers / CSV content": "الأرقام / محتوى CSV",
    "Paste one phone per line, or paste the CSV content with columns like Contact Name, Phone, Salesperson.": "الصق رقم في كل سطر، أو الصق محتوى CSV بأعمدة مثل Contact Name, Phone, Salesperson.",
    "Upload CSV or XLSX": "رفع CSV أو XLSX",
    "Selected file": "الملف المختار",
    "No file selected.": "لم يتم اختيار ملف.",
    "Phone scan limit": "حد فحص الأرقام",
    "Preview phone matches": "معاينة الأرقام المطابقة",
    "Previewing...": "جاري المعاينة...",
    "Execute phone assignment": "تنفيذ تعيين الأرقام",
    "Matched conversations": "المحادثات المطابقة",
    "Numbers not ready": "أرقام غير جاهزة",
    "The app searches Chatwoot contacts by phone, then assigns the matching conversations only. Nothing changes before execution.": "التطبيق يبحث عن العميل في Chatwoot بالرقم، ثم يعيّن المحادثات المطابقة فقط. لا يحدث أي تعديل قبل التنفيذ.",
    "This inbox is a source filter for existing conversations, not a destination. If a number has no conversation/contact in these filters, it will appear under Numbers not ready.": "الإنبوكس هنا فلتر للمحادثات الموجودة، مش وجهة نقل. لو الرقم ملوش محادثة/عميل مطابق في الفلاتر دي هيظهر تحت أرقام غير جاهزة.",
    "File read: {count} phone number(s) found.": "تمت قراءة الملف: اتلاقى {count} رقم.",
    "Could not read phone numbers from this file.": "لم أقدر أقرأ أرقام من الملف ده.",
    "Only the first {count} numbers will be checked in this preview. Increase it after the first preview looks correct.": "هيتم فحص أول {count} رقم فقط في المعاينة دي. زوّد الرقم بعد ما أول معاينة تبقى مظبوطة.",
    "Add a CSV/XLSX file or paste phone numbers first.": "ارفع ملف CSV/XLSX أو الصق الأرقام الأول.",
    "Choose the target agent first.": "اختار الموظف المستهدف الأول.",
    "Phone preview finished: {matched}/{phones} phone(s) matched.": "انتهت المعاينة: {matched}/{phones} رقم له محادثات مطابقة.",
    "Phone assignment finished: {succeeded}/{total} succeeded.": "انتهى تعيين الأرقام: {succeeded}/{total} نجحت.",
    "Execute assignment for {count} conversation(s)?": "تنفذ التعيين على {count} محادثة؟",
    "File loaded. Preview to check Chatwoot matches.": "تم تحميل الملف. اعمل معاينة عشان تتأكد من المطابقات في Chatwoot.",
    "Contact not found": "العميل غير موجود",
    "No matching conversation": "لا توجد محادثة مطابقة",
    "No exact phone match in Chatwoot search results": "نتائج البحث رجعت عملاء، لكن مفيش تطابق فعلي مع رقم العميل",
    "Exact phone": "تطابق رقم كامل",
    "Phone tail match": "تطابق آخر الرقم",
    "phoneCount": "عدد الأرقام",
    "matchedPhoneCount": "أرقام مطابقة",
    "inputPhone": "الرقم في الملف",
    "normalizedPhone": "الرقم بعد التنظيف",
    "targetAgentId": "الموظف المستهدف",
    "matchStatus": "نوع التطابق",
    "contactSearchMatches": "نتائج بحث العميل",
    "reason": "السبب",
    "phoneNumber": "رقم العميل",
    "openCount": "عدد المفتوح",
    "assignedCount": "عدد المعيّن",
    "unassignedCount": "عدد غير المعيّن",
    "unreadCount": "عدد غير المقروء",
    "assignedUnreadCount": "غير المقروء المعيّن",
    "unassignedUnreadCount": "غير المقروء بدون موظف",
    "agentId": "رقم الموظف",
    "agentName": "اسم الموظف",
    "Unread only": "غير المقروء فقط",
    "Only unread conversations": "المحادثات غير المقروءة فقط",
    "Unread conversations": "محادثات غير مقروءة",
    "Unread by inbox": "غير المقروء حسب الإنبوكس",
    "Open conversations with unread messages, grouped by inbox.": "المحادثات المفتوحة اللي فيها رسائل غير مقروءة، مجمعة حسب الإنبوكس.",
    "Unread conversation list": "قائمة المحادثات غير المقروءة",
    "Unread filtering is applied locally after Chatwoot returns conversations, so increase the page limit if you expect many open conversations.": "فلتر غير المقروء بيتطبق محليًا بعد ما Chatwoot يرجع المحادثات، فزوّد حد الصفحات لو عندك محادثات مفتوحة كتير.",
    "Check sales reply status": "فحص رد السيلز",
    "Only customers needing a sales reply": "العملاء اللي محتاجين رد فقط",
    "Sales reply check limit": "حد فحص رد السيلز",
    "Sales reply checking reads messages inside each conversation, so start with a small limit and increase it after the report looks correct.": "فحص رد السيلز بيقرأ الرسائل جوه كل محادثة، فابدأ بحد صغير وزوّده بعد ما التقرير يبقى مظبوط.",
    "Needs sales reply": "محتاج رد من السيلز",
    "Replied by sales": "تم الرد من السيلز",
    "Reply status unknown": "حالة الرد غير معروفة",
    "Customers needing reply": "عملاء محتاجين رد",
    "Sales reply summary": "ملخص رد السيلز",
    "replyStatus": "حالة رد السيلز",
    "needsReply": "محتاج رد؟",
    "needsReplyCount": "محتاجين رد",
    "repliedCount": "تم الرد عليهم",
    "replyUnknownCount": "لم يتم الفحص",
    "lastCustomerMessageAt": "آخر رسالة عميل",
    "lastSalesReplyAt": "آخر رد سيلز",
    "lastSalesReplyBy": "آخر رد بواسطة",
    "lastMessageAt": "آخر رسالة",
    "lastMessageDirection": "اتجاه آخر رسالة",
    "needs_reply": "محتاج رد",
    "replied": "تم الرد",
    "no_customer_message": "لا توجد رسالة عميل",
    "not_checked": "لم يتم الفحص",
    "unknown": "غير معروف",
    "customer": "عميل",
    "sales": "سيلز",
    "Yes": "نعم",
    "No": "لا",
    "Download report CSV": "تحميل التقرير CSV",
    "No report to download.": "لا يوجد تقرير لتحميله.",
    "Report CSV downloaded.": "تم تحميل التقرير CSV.",
    "Also reassign conversations for these customers": "حوّل محادثات العملاء دول كمان",
    "Tip: start with Open conversations and a small page limit. After Preview looks correct, increase the limit and execute.": "نصيحة: ابدأ بالمحادثات المفتوحة وحد صفحات صغير. بعد ما المعاينة تبقى مظبوطة، زود الحد ونفذ.",
    "Select agent": "اختار موظف",
    "Select team": "اختار فريق",
    "No rows yet.": "لا توجد بيانات بعد.",
    "Download": "تحميل",
    "createdAt": "تاريخ الإنشاء",
    "action": "الإجراء",
    "summary": "الملخص",
    "actor.name": "من نفذ",
    "metadata.jobId": "رقم العملية",
    "receivedAt": "وقت الاستلام",
    "event": "الحدث",
    "campaignId": "رقم الحملة",
    "name": "الاسم",
    "chatwootCampaignId": "رقم حملة Chatwoot",
    "ownerName": "المسؤول",
    "sentCount": "تم الإرسال",
    "deliveredCount": "تم التسليم",
    "repliedCount": "ردود",
    "failedCount": "فشل",
    "total": "الإجمالي",
    "succeeded": "نجح",
    "failed": "فشل",
    "id": "الرقم",
    "type": "النوع",
    "conversationId": "رقم المحادثة",
    "inboxId": "رقم الإنبوكس",
    "inboxName": "اسم الإنبوكس",
    "contactId": "رقم العميل",
    "contactName": "اسم العميل",
    "contactDisplay": "العميل / الرقم",
    "status": "الحالة",
    "assigneeName": "الموظف",
    "source": "المصدر",
    "metric": "المؤشر",
    "points": "النقاط",
    "Ops Console": "لوحة العمليات",
    "Bulk control for Chatwoot": "تحكم جماعي لـ Chatwoot"
  }
};

Object.assign(translations.ar, {
  "Automation": "الأتمتة",
  "Configure chatbot routing, assignment windows, and allowed agents.": "اضبط رسائل البوت، مواعيد التعيين، والموظفين المسموح لهم.",
  "Automation Control": "تحكم الأتمتة",
  "These settings are used by the Chatwoot webhook without redeploying Railway.": "الإعدادات دي بيستخدمها Webhook من غير إعادة نشر Railway.",
  "Load settings": "تحميل الإعدادات",
  "Save automation settings": "حفظ إعدادات الأتمتة",
  "Department router": "راوتر الأقسام",
  "Enable department router": "تشغيل راوتر الأقسام",
  "Prompt new conversations": "إرسال القائمة للمحادثات الجديدة",
  "Prompt resolved conversations": "إرسال القائمة بعد إعادة فتح محادثة مغلقة",
  "New contacts only": "عملاء جدد فقط",
  "Skip campaigns": "تجاهل محادثات الحملات",
  "Assign agent automatically": "تعيين موظف تلقائيا",
  "Confirm customer selection": "تأكيد اختيار العميل",
  "Move chats away from unavailable manual assignees": "سحب الشات من الموظف غير المتاح حتى لو التعيين يدوي",
  "Manual fallback": "تصرف الشات غير المعروف",
  "Unassign": "بدون تعيين",
  "Send menu": "إرسال القائمة",
  "Ignore": "تجاهل",
  "Unavailable statuses": "حالات عدم التوفر",
  "Choose routed inboxes": "اختار الإنبوكسات",
  "Sales team": "فريق المبيعات",
  "Operations team": "فريق العمليات",
  "Allowed sales agents": "موظفين المبيعات المسموح لهم",
  "Allowed operations agents": "موظفين العمليات المسموح لهم",
  "Sales assignment mode": "طريقة تعيين المبيعات",
  "Online only": "أونلاين فقط",
  "Any status": "أي حالة",
  "Business hours": "مواعيد العمل",
  "Enable business hours": "تشغيل مواعيد العمل",
  "Timezone": "المنطقة الزمنية",
  "Start time": "وقت البداية",
  "End time": "وقت النهاية",
  "Working days": "أيام العمل",
  "Sunday": "الأحد",
  "Monday": "الإثنين",
  "Tuesday": "الثلاثاء",
  "Wednesday": "الأربعاء",
  "Thursday": "الخميس",
  "Friday": "الجمعة",
  "Saturday": "السبت",
  "Chatbot messages": "رسائل البوت",
  "Main menu text": "نص القائمة الرئيسية",
  "Sales confirmation": "رسالة تأكيد المبيعات",
  "Operations confirmation": "رسالة تأكيد العمليات",
  "Operations data prompt": "رسالة طلب بيانات العمليات",
  "Complaint intro": "رسالة بداية الشكاوى",
  "Complaint data prompt": "رسالة بيانات الشكوى",
  "Complaint received text": "رسالة استلام الشكوى",
  "Complaint owner": "مسؤول الشكاوى",
  "Complaint agent ID": "ID مسؤول الشكاوى",
  "Complaint agent email": "إيميل مسؤول الشكاوى",
  "Complaint agent name": "اسم مسؤول الشكاوى",
  "Reopen router": "راوتر إعادة الفتح",
  "Fahd Botpress": "فهد Botpress",
  "Enable Fahd handoff": "تشغيل تسليم فهد",
  "Require resolved re-entry": "تشغيل فهد بعد Resolved فقط",
  "Skip broadcast handoffs": "تجاهل تسليمات البرودكاست",
  "Fahd working hours": "مواعيد عمل فهد",
  "In-hours queue message": "رسالة الانتظار داخل مواعيد العمل",
  "Outside-hours message": "رسالة خارج مواعيد العمل",
  "Outside-hours mode": "تصرف خارج مواعيد العمل",
  "Send message only": "إرسال الرسالة فقط",
  "Return message to Botpress": "إرجاع الرسالة لـ Botpress",
  "Botpress should call /botpress-cloud with x-botpress-secret. Outside working hours, the app sends only this message and does not open, assign, or add a private note.": "Botpress ينادي /botpress-cloud مع x-botpress-secret. خارج مواعيد العمل، التطبيق يرسل الرسالة فقط ولا يفتح ولا يعمل تعيين ولا يضيف private note.",
  "Botpress calls /botpress-cloud after Fahd collects the customer details. The app only handles resolved re-entry conversations; if no online agent is available it leaves the chat unassigned and sends the matching queue message.": "Botpress ينادي /botpress-cloud بعد ما فهد يجمع بيانات العميل. التطبيق يتعامل فقط مع محادثات رجعت بعد Resolved؛ لو مفيش موظف أونلاين يسيب الشات Unassigned ويبعت رسالة الانتظار المناسبة.",
  "Enable reopen router": "تشغيل راوتر إعادة الفتح",
  "Reopen team": "فريق إعادة الفتح",
  "Allowed reopen agents": "موظفين إعادة الفتح المسموح لهم",
  "Assign unassigned conversations": "تعيين المحادثات غير المعينة",
  "Fallback": "التصرف الاحتياطي",
  "Move to team": "تحويل لفريق",
  "Do nothing": "بدون إجراء",
  "Cooldown seconds": "فاصل التكرار بالثواني",
  "Automation settings loaded.": "تم تحميل إعدادات الأتمتة.",
  "Automation settings saved.": "تم حفظ إعدادات الأتمتة.",
  "Saved settings": "إعدادات محفوظة",
  "Environment defaults": "إعدادات من Railway",
  "Last saved": "آخر حفظ",
  "When enabled, the router can release an offline/busy/away manual assignee so customers do not wait on someone unavailable.": "عند تشغيله، يقدر الراوتر يسحب الشات من موظف offline/busy/away حتى لو التعيين كان يدوي.",
  "Use this only for inboxes fully owned by this app. Keep Chatwoot auto assignment and automation rules disabled there.": "استخدم ده فقط للإنبوكسات اللي التطبيق مسؤول عنها بالكامل. لازم Auto assignment و Automations في Chatwoot تفضل مقفولة هناك."
});

const tabs = [
  ["actions", "Actions"],
  ["automation", "Automation"],
  ["open_report", "Open Report"],
  ["phone_assign", "Phone Assign"],
  ["dashboard", "Dashboard"],
  ["analytics", "Analytics"],
  ["campaigns", "Campaigns"],
  ["audit", "Logs"],
  ["exports", "Exports"],
  ["settings", "Setup"]
];

const titles = {
  actions: ["Actions", "Run bulk transfers safely in three steps: choose, preview, execute."],
  automation: ["Automation", "Configure chatbot routing, assignment windows, and allowed agents."],
  open_report: ["Open Report", "Open conversations by inbox, unassigned queue, and selected agents."],
  phone_assign: ["Phone Assign", "Assign open conversations by uploaded or pasted phone numbers."],
  dashboard: ["Dashboard", "Counters, report snapshots, and Chatwoot embedded context."],
  analytics: ["Analytics", "Lead sources, CSAT, and per-agent / per-team response times."],
  campaigns: ["Campaigns", "Track local campaigns and Chatwoot webhook reply signals."],
  audit: ["Logs", "Who did what, when, and which bulk job changed it."],
  exports: ["Exports", "Download CSV files for audit logs, campaigns, and bulk jobs."],
  settings: ["Setup", "Connect this app to your self-hosted Chatwoot instance."]
};

const quickActions = {
  assign_agent: {
    label: "Transfer to agent",
    shortLabel: "Agent",
    description: "Move all selected conversations from one sales/agent to another.",
    scope: "conversations"
  },
  unassign: {
    label: "Remove assignee",
    shortLabel: "Unassign",
    description: "Take conversations away from an agent and return them to Unassigned.",
    scope: "conversations"
  },
  assign_team: {
    label: "Move to team",
    shortLabel: "Team",
    description: "Route a batch of conversations to a team queue.",
    scope: "conversations"
  },
  contact_owner: {
    label: "Transfer customer owner",
    shortLabel: "Owner",
    description: "Change the contact owner custom attribute, with optional conversation reassignment.",
    scope: "contacts",
    action: "assign_agent"
  }
};

document.addEventListener("DOMContentLoaded", () => {
  setEmbeddedMode();
  applyLocale();
  renderNav();
  bindDashboardAppContext();
  document.getElementById("language-toggle").addEventListener("click", toggleLanguage);
  document.getElementById("refresh-button").addEventListener("click", refreshActiveTab);
  render();
  refreshBaseData();
  loadAutomationSettings({ quiet: true }).catch(error => notify(error.message || "Request failed", "bad"));
});

function renderNav() {
  const containers = [document.getElementById("nav"), document.getElementById("compact-nav")].filter(Boolean);
  containers.forEach(nav => {
    nav.innerHTML = tabs.map(([id, label]) => (
      `<button type="button" data-tab="${id}" class="${state.tab === id ? "active" : ""}">${tr(label)}</button>`
    )).join("");
    nav.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        state.tab = button.dataset.tab;
        render();
        refreshActiveTab();
      });
    });
  });
}

function render() {
  renderNav();
  const [title, subtitle] = titles[state.tab];
  document.getElementById("page-title").textContent = tr(title);
  document.getElementById("page-subtitle").textContent = tr(subtitle);
  document.getElementById("connection-state").textContent = hasConnection() ? tr("Connected config") : tr("Not connected");
  document.getElementById("connection-state").className = `pill ${hasConnection() ? "ok" : "neutral"}`;
  renderContextBox();

  const view = document.getElementById("view");
  if (state.tab === "actions") view.innerHTML = actionsView();
  if (state.tab === "automation") view.innerHTML = automationView();
  if (state.tab === "open_report") view.innerHTML = openReportView();
  if (state.tab === "phone_assign") view.innerHTML = phoneAssignView();
  if (state.tab === "dashboard") view.innerHTML = dashboardView();
  if (state.tab === "analytics") view.innerHTML = analyticsView();
  if (state.tab === "campaigns") view.innerHTML = campaignsView();
  if (state.tab === "audit") view.innerHTML = auditView();
  if (state.tab === "exports") view.innerHTML = exportsView();
  if (state.tab === "settings") view.innerHTML = settingsView();
  bindViewEvents();
}

function actionsView() {
  const criteria = state.bulkCriteria;
  const activePreset = criteria.scope === "contacts" ? "contact_owner" : criteria.action || "assign_agent";
  return `
    ${embeddedBanner()}
    <div class="action-layout">
      <section class="panel action-panel">
        <div class="panel-header">
          <div>
            <h2>${tr("Quick actions")}</h2>
            <p class="panel-note">${tr("Pick the job you want. Nothing is changed until you preview and confirm.")}</p>
          </div>
          <span class="pill ${hasConnection() ? "ok" : "warn"}">${hasConnection() ? tr("Connected") : tr("Needs setup")}</span>
        </div>
        <div class="panel-body">
          <div class="action-cards">
            ${Object.entries(quickActions).map(([id, action]) => `
              <button class="action-card ${activePreset === id ? "active" : ""}" type="button" data-quick-action="${id}">
                <span>${tr(action.shortLabel)}</span>
                <strong>${tr(action.label)}</strong>
                <small>${tr(action.description)}</small>
              </button>
            `).join("")}
          </div>
        </div>
      </section>
      <aside class="guide-panel">
        <h2>${tr("How it works")}</h2>
        <ol class="steps-list">
          <li><strong>${tr("Choose action")}</strong><span>${tr("Select transfer, unassign, team routing, or contact owner transfer.")}</span></li>
          <li><strong>${tr("Preview")}</strong><span>${tr("The app asks Chatwoot for matching conversations/customers and shows the exact rows.")}</span></li>
          <li><strong>${tr("Execute")}</strong><span>${tr("Only after confirmation, it calls Chatwoot assignment/contact APIs and logs every row.")}</span></li>
        </ol>
        <p class="guide-note">${tr("For Chatwoot Dashboard App usage: add the Railway URL in Chatwoot Settings -> Integrations -> Dashboard Apps.")}</p>
      </aside>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div>
          <h2>${tr(quickActions[activePreset]?.label || "Bulk action")}</h2>
          <p class="panel-note">${tr(quickActions[activePreset]?.description || "")}</p>
        </div>
        <span class="pill neutral">${state.preview?.count ?? 0} ${tr("previewed")}</span>
      </div>
      <div class="panel-body">
        ${workflowSteps()}
        ${actionForm(criteria)}
        <div class="actions sticky-actions">
          <button class="button" data-action="preview-bulk">${tr("Preview affected rows")}</button>
          <button class="button danger" data-action="execute-bulk" ${state.preview?.count ? "" : "disabled"}>${tr("Execute confirmed action")}</button>
        </div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div>
          <h2>${tr("Preview before execution")}</h2>
          <p class="panel-note">${tr("Review the first 100 affected rows. Export full results after execution.")}</p>
        </div>
        ${state.preview ? `<span class="pill warn">${state.preview.count} ${tr("rows")}</span>` : ""}
      </div>
      <div class="panel-body">${previewTable()}</div>
    </section>
  `;
}

function automationView() {
  const settings = state.automationSettings || defaultClientAutomationSettings();
  const department = settings.department || {};
  const reopen = settings.reopen || {};
  const botpress = settings.botpress || {};
  const meta = state.automationSettingsMeta || {};
  return `
    ${embeddedBanner()}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>${tr("Automation Control")}</h2>
          <p class="panel-note">${tr("These settings are used by the Chatwoot webhook without redeploying Railway.")}</p>
        </div>
        <span class="pill ${meta.saved ? "ok" : "warn"}">${tr(meta.saved ? "Saved settings" : "Environment defaults")}</span>
      </div>
      <div class="panel-body">
        <p class="notice warn">${tr("Use this only for inboxes fully owned by this app. Keep Chatwoot auto assignment and automation rules disabled there.")}</p>
        ${meta.updatedAt ? `<p class="notice">${tr("Last saved")}: ${escapeHtml(meta.updatedAt)}</p>` : ""}
        <div class="actions">
          <button class="button secondary" data-action="load-automation-settings">${tr("Load settings")}</button>
          <button class="button" data-action="save-automation-settings">${tr("Save automation settings")}</button>
        </div>
      </div>
    </section>

    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Fahd Botpress")}</h2></div>
      <div class="panel-body">
        <p class="notice">${tr("Botpress calls /botpress-cloud after Fahd collects the customer details. The app only handles resolved re-entry conversations; if no online agent is available it leaves the chat unassigned and sends the matching queue message.")}</p>
        <div class="grid two">
          ${checkboxPanel([
            ["automationBotpressEnabled", "Enable Fahd handoff", botpress.enabled],
            ["automationBotpressRequireResolvedReentry", "Require resolved re-entry", botpress.requireResolvedReentry],
            ["automationBotpressWorkingHoursEnabled", "Enable business hours", botpress.workingHoursEnabled],
            ["automationBotpressSkipBroadcasts", "Skip broadcast handoffs", botpress.skipBroadcasts]
          ])}
          ${dayCheckboxGroup("automationBotpressDays", "Fahd working hours", botpress.days || [])}
        </div>
        <div class="form-grid span-all">
          ${inputField("automationBotpressTimezone", "Timezone", botpress.timezone || "Africa/Cairo")}
          ${inputField("automationBotpressStart", "Start time", botpress.start || "10:00")}
          ${inputField("automationBotpressEnd", "End time", botpress.end || "21:00")}
        </div>
        <div class="span-all">
          ${textareaField("automationBotpressInHoursQueueMessage", "In-hours queue message", botpress.inHoursQueueMessage || "")}
        </div>
        <div class="span-all">
          ${textareaField("automationBotpressOutsideHoursMessage", "Outside-hours message", botpress.outsideHoursMessage || "")}
        </div>
      </div>
    </section>

    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Department router")}</h2></div>
      <div class="panel-body">
        <div class="grid two">
          ${checkboxPanel([
            ["automationDepartmentEnabled", "Enable department router", department.enabled],
            ["automationPromptOnNew", "Prompt new conversations", department.promptOnNew],
            ["automationPromptOnResolved", "Prompt resolved conversations", department.promptOnResolved],
            ["automationNewContactsOnly", "New contacts only", department.newContactsOnly],
            ["automationSkipCampaigns", "Skip campaigns", department.skipCampaigns],
            ["automationAssignAgent", "Assign agent automatically", department.assignAgent],
            ["automationConfirmSelection", "Confirm customer selection", department.confirmSelection],
            ["automationRerouteUnavailableManual", "Move chats away from unavailable manual assignees", department.rerouteUnavailableManualAssignments]
          ])}
          <div>
            ${checkboxGroup("automationInboxIds", "Choose routed inboxes", state.inboxes.map(inbox => [inbox.id, `${inbox.name} (${inbox.channel_type || inbox.channelType || "inbox"})`]), department.inboxIds)}
            <p class="notice">${tr("When enabled, the router can release an offline/busy/away manual assignee so customers do not wait on someone unavailable.")}</p>
          </div>
        </div>
        <div class="form-grid span-all">
          ${teamSelect("automationSalesTeamId", "Sales team", department.salesTeamId)}
          ${teamSelect("automationOperationsTeamId", "Operations team", department.operationsTeamId)}
          ${selectField("automationSalesAssignmentMode", "Sales assignment mode", [["online", "Online only"], ["any_status", "Any status"]], department.salesAssignmentMode || "online")}
          ${selectField("automationUnavailableManualFallback", "Manual fallback", [["unassign", "Unassign"], ["prompt", "Send menu"], ["ignore", "Ignore"]], department.unavailableManualFallback || "unassign")}
          ${inputField("automationManualUnavailableStatuses", "Unavailable statuses", (department.manualAssignmentUnavailableStatuses || []).join(","))}
        </div>
        <div class="grid two" style="margin-top:14px">
          ${checkboxGroup("automationSalesAgentIds", "Allowed sales agents", state.agents.map(agent => [agent.id, `${agent.name} (${agent.email || agent.availability_status || ""})`]), department.salesAgentIds)}
          ${checkboxGroup("automationOperationsAgentIds", "Allowed operations agents", state.agents.map(agent => [agent.id, `${agent.name} (${agent.email || agent.availability_status || ""})`]), department.operationsAgentIds)}
        </div>
      </div>
    </section>

    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Business hours")}</h2></div>
      <div class="panel-body">
        <label class="field checkbox-field">
          <span><input type="checkbox" id="automationBusinessHoursEnabled" ${department.businessHoursEnabled ? "checked" : ""}> ${tr("Enable business hours")}</span>
        </label>
        <div class="form-grid">
          ${inputField("automationBusinessTimezone", "Timezone", department.businessTimezone || "Africa/Cairo")}
          ${inputField("automationBusinessStart", "Start time", department.businessStart || "09:00")}
          ${inputField("automationBusinessEnd", "End time", department.businessEnd || "22:00")}
        </div>
        <div class="span-all">${dayCheckboxGroup("automationBusinessDays", "Working days", department.businessDays || [])}</div>
      </div>
    </section>

    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Chatbot messages")}</h2></div>
      <div class="panel-body">
        <div class="form-grid">
          ${textareaField("automationPromptText", "Main menu text", department.promptText)}
          ${textareaField("automationOperationsDataPromptText", "Operations data prompt", department.operationsDataPromptText)}
          ${textareaField("automationSalesConfirmationText", "Sales confirmation", department.salesConfirmationText)}
          ${textareaField("automationOperationsConfirmationText", "Operations confirmation", department.operationsConfirmationText)}
          ${textareaField("automationComplaintIntroText", "Complaint intro", department.complaintIntroText)}
          ${textareaField("automationComplaintDataPromptText", "Complaint data prompt", department.complaintDataPromptText)}
          ${textareaField("automationComplaintReceivedText", "Complaint received text", department.complaintReceivedText)}
        </div>
        <h3>${tr("Complaint owner")}</h3>
        <div class="form-grid">
          ${inputField("automationComplaintAgentId", "Complaint agent ID", department.complaintAgentId || "")}
          ${inputField("automationComplaintAgentEmail", "Complaint agent email", department.complaintAgentEmail || "")}
          ${inputField("automationComplaintAgentName", "Complaint agent name", department.complaintAgentName || "Abdelrahman Tarek")}
        </div>
      </div>
    </section>

    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Reopen router")}</h2></div>
      <div class="panel-body">
        <label class="field checkbox-field">
          <span><input type="checkbox" id="automationReopenEnabled" ${reopen.enabled ? "checked" : ""}> ${tr("Enable reopen router")}</span>
        </label>
        <div class="grid two">
          ${checkboxGroup("automationReopenInboxIds", "Choose routed inboxes", state.inboxes.map(inbox => [inbox.id, `${inbox.name} (${inbox.channel_type || inbox.channelType || "inbox"})`]), reopen.inboxIds)}
          ${checkboxGroup("automationReopenAgentIds", "Allowed reopen agents", state.agents.map(agent => [agent.id, `${agent.name} (${agent.email || agent.availability_status || ""})`]), reopen.agentIds)}
        </div>
        <div class="form-grid span-all">
          ${teamSelect("automationReopenTeamId", "Reopen team", reopen.teamId)}
          ${selectField("automationReopenFallback", "Fallback", [["unassign", "Unassign"], ["team", "Move to team"], ["none", "Do nothing"]], reopen.fallback || "unassign")}
          ${inputField("automationReopenStatuses", "Unavailable statuses", (reopen.unavailableStatuses || []).join(","))}
          ${inputField("automationReopenCooldown", "Cooldown seconds", reopen.cooldownSeconds || "60", "number")}
        </div>
        <label class="field checkbox-field">
          <span><input type="checkbox" id="automationReopenAssignUnassigned" ${reopen.assignUnassigned ? "checked" : ""}> ${tr("Assign unassigned conversations")}</span>
        </label>
        <label class="field checkbox-field">
          <span><input type="checkbox" id="automationReopenSkipCampaigns" ${reopen.skipCampaigns ? "checked" : ""}> ${tr("Skip campaigns")}</span>
        </label>
      </div>
    </section>
  `;
}

function dashboardView() {
  const metric = state.metrics || {};
  const conversationMetrics = metric.conversationMetrics || {};
  return `
    <div class="grid three">
      ${stat("Open", conversationMetrics.open ?? "-")}
      ${stat("Unassigned", conversationMetrics.unassigned ?? "-")}
      ${stat("Unattended", conversationMetrics.unattended ?? "-")}
    </div>
    <div class="grid two" style="margin-top:16px">
      <section class="panel">
        <div class="panel-header"><h2>${tr("Chatwoot Reports")}</h2><button class="button secondary" data-action="load-reports">${tr("Load reports")}</button></div>
        <div class="panel-body">${reportsTable()}</div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>${tr("Dashboard App Context")}</h2><button class="button secondary" data-action="request-context">${tr("Request context")}</button></div>
        <div class="panel-body">${contextDetails()}</div>
      </section>
    </div>
  `;
}

function openReportView() {
  const report = state.openReport;
  const totals = report?.totals || {};
  const showReplyStats = Boolean(report?.criteria?.includeReplyStatus || state.openReportCriteria.includeReplyStatus || state.openReportCriteria.needsReplyOnly);
  return `
    ${embeddedBanner()}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>${tr("Open conversation report")}</h2>
          <p class="panel-note">${tr("This report does not change anything. It only reads open conversations from Chatwoot.")}</p>
        </div>
      </div>
      <div class="panel-body">
        <div class="grid two">
          ${checkboxGroup("reportInboxIds", "Choose inboxes", state.inboxes.map(inbox => [inbox.id, `${inbox.name} (${inbox.channel_type || inbox.channelType || "inbox"})`]), state.openReportCriteria.inboxIds)}
          ${checkboxGroup("reportAgentIds", "Choose agents", state.agents.map(agent => [agent.id, `${agent.name} (${agent.email})`]), state.openReportCriteria.agentIds)}
        </div>
        <div class="form-grid" style="margin-top:14px">
          ${inputField("reportMaxPages", "Search limit: Chatwoot API pages", state.openReportCriteria.maxPages || "20", "number")}
          ${inputField("reportReplyCheckLimit", "Sales reply check limit", state.openReportCriteria.replyCheckLimit || "100", "number")}
        </div>
        <label class="field checkbox-field">
          <span><input type="checkbox" id="reportUnreadOnly" ${state.openReportCriteria.unreadOnly ? "checked" : ""}> ${tr("Unread only")}</span>
        </label>
        <label class="field checkbox-field">
          <span><input type="checkbox" id="reportIncludeReplyStatus" ${state.openReportCriteria.includeReplyStatus ? "checked" : ""}> ${tr("Check sales reply status")}</span>
        </label>
        <label class="field checkbox-field">
          <span><input type="checkbox" id="reportNeedsReplyOnly" ${state.openReportCriteria.needsReplyOnly ? "checked" : ""}> ${tr("Only customers needing a sales reply")}</span>
        </label>
        <p class="notice">${tr("Leave empty to include all.")} ${tr("Chatwoot sends results in pages. 20 means scan up to 20 API pages, then stop for safety. This does not execute anything.")}</p>
        <p class="notice">${tr("Unread filtering is applied locally after Chatwoot returns conversations, so increase the page limit if you expect many open conversations.")}</p>
        <p class="notice">${tr("Sales reply checking reads messages inside each conversation, so start with a small limit and increase it after the report looks correct.")}</p>
        <div class="actions">
          <button class="button" data-action="load-open-report">${tr("Run open report")}</button>
          <button class="button secondary" data-action="export-open-report" ${report?.conversations?.length ? "" : "disabled"}>${tr("Download report CSV")}</button>
        </div>
      </div>
    </section>
    <div class="grid three" style="margin-top:16px">
      ${stat("Open conversations", totals.openCount ?? "-")}
      ${stat("Assigned conversations", totals.assignedCount ?? "-")}
      ${stat("Unassigned conversations", totals.unassignedCount ?? "-")}
    </div>
    <div class="grid three" style="margin-top:16px">
      ${stat("Unread conversations", totals.unreadCount ?? "-")}
      ${stat("assignedUnreadCount", totals.assignedUnreadCount ?? "-")}
      ${stat("unassignedUnreadCount", totals.unassignedUnreadCount ?? "-")}
    </div>
    ${showReplyStats ? `
      <div class="grid three" style="margin-top:16px">
        ${stat("Needs sales reply", totals.needsReplyCount ?? "-")}
        ${stat("Replied by sales", totals.repliedCount ?? "-")}
        ${stat("Reply status unknown", totals.replyUnknownCount ?? "-")}
      </div>
    ` : ""}
    ${openReportTables()}
  `;
}

function openReportTables() {
  if (!state.openReport) return `<section class="panel" style="margin-top:16px"><div class="panel-body"><p class="notice">${tr("Run the report first.")}</p></div></section>`;
  const warnings = (state.openReport.warnings || []).map(item => `<p class="notice warn">${escapeHtml(item)}</p>`).join("");
  const includeReplyStatus = Boolean(state.openReport.criteria?.includeReplyStatus);
  const localizeRows = rows => includeReplyStatus ? rows.map(localizeReplyRow) : rows;
  const unassignedByInbox = state.openReport.inboxes
    .map(row => ({
      inboxName: row.inboxName,
      inboxId: row.inboxId,
      unassignedCount: row.unassignedCount,
      openCount: row.openCount
    }))
    .sort((a, b) => Number(b.unassignedCount || 0) - Number(a.unassignedCount || 0) || String(a.inboxName).localeCompare(String(b.inboxName)));
  const unreadByInbox = state.openReport.inboxes
    .map(row => ({
      inboxName: row.inboxName,
      inboxId: row.inboxId,
      unreadCount: row.unreadCount,
      openCount: row.openCount
    }))
    .sort((a, b) => Number(b.unreadCount || 0) - Number(a.unreadCount || 0) || String(a.inboxName).localeCompare(String(b.inboxName)));
  const inboxSummaryColumns = includeReplyStatus
    ? ["inboxName", "inboxId", "openCount", "unreadCount", "needsReplyCount", "repliedCount", "replyUnknownCount", "assignedCount", "unassignedCount"]
    : ["inboxName", "inboxId", "openCount", "unreadCount", "assignedCount", "unassignedCount"];
  const agentSummaryColumns = includeReplyStatus
    ? ["agentName", "agentId", "openCount", "unreadCount", "needsReplyCount", "repliedCount", "replyUnknownCount"]
    : ["agentName", "agentId", "openCount", "unreadCount"];
  const conversationColumns = includeReplyStatus
    ? ["conversationId", "inboxName", "contactDisplay", "assigneeName", "replyStatus", "lastCustomerMessageAt", "lastSalesReplyAt", "lastSalesReplyBy", "unreadCount", "status", "source"]
    : ["conversationId", "inboxName", "contactDisplay", "assigneeName", "unreadCount", "status", "source"];
  const unassignedColumns = includeReplyStatus
    ? ["conversationId", "inboxName", "contactDisplay", "replyStatus", "lastCustomerMessageAt", "lastSalesReplyAt", "unreadCount", "status", "source"]
    : ["conversationId", "inboxName", "contactDisplay", "unreadCount", "status", "source"];
  return `
    ${warnings}
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div>
          <h2>${tr("Unassigned by inbox")}</h2>
          <p class="panel-note">${tr("Open conversations without an assignee, grouped by inbox.")}</p>
        </div>
      </div>
      <div class="panel-body">${simpleTable(unassignedByInbox, ["inboxName", "inboxId", "unassignedCount", "openCount"])}</div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div>
          <h2>${tr("Unread by inbox")}</h2>
          <p class="panel-note">${tr("Open conversations with unread messages, grouped by inbox.")}</p>
        </div>
      </div>
      <div class="panel-body">${simpleTable(unreadByInbox, ["inboxName", "inboxId", "unreadCount", "openCount"])}</div>
    </section>
    <div class="grid two" style="margin-top:16px">
      <section class="panel">
        <div class="panel-header"><h2>${tr("Inbox summary")}</h2></div>
        <div class="panel-body">${simpleTable(state.openReport.inboxes, inboxSummaryColumns)}</div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>${tr("Agent summary")}</h2></div>
        <div class="panel-body">${simpleTable(state.openReport.agents, agentSummaryColumns)}</div>
      </section>
    </div>
    ${includeReplyStatus ? `
      <section class="panel" style="margin-top:16px">
        <div class="panel-header"><h2>${tr("Customers needing reply")}</h2></div>
        <div class="panel-body">${simpleTable(localizeRows((state.openReport.selectedAgentNeedsReply || state.openReport.needsReply || []).slice(0, 200)), ["conversationId", "inboxName", "contactDisplay", "assigneeName", "replyStatus", "lastCustomerMessageAt", "lastSalesReplyAt", "lastSalesReplyBy", "unreadCount"])}</div>
      </section>
    ` : ""}
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Unassigned conversations")}</h2></div>
      <div class="panel-body">${simpleTable(localizeRows(state.openReport.unassigned.slice(0, 200)), unassignedColumns)}</div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Unread conversation list")}</h2></div>
      <div class="panel-body">${simpleTable(localizeRows((state.openReport.unread || []).slice(0, 200)), conversationColumns)}</div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Open conversation list")}</h2></div>
      <div class="panel-body">${simpleTable(localizeRows(state.openReport.conversations.slice(0, 200)), conversationColumns)}</div>
    </section>
  `;
}

function phoneAssignView() {
  const criteria = state.phoneAssign;
  const preview = state.phonePreview;
  const parse = state.phoneParse;
  const isPreviewing = state.loadingAction === "preview-phone-assign";
  return `
    ${embeddedBanner()}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>${tr("Assign from phone list")}</h2>
          <p class="panel-note">${tr("Paste numbers or upload CSV/XLSX, choose the employee, preview, then execute.")}</p>
        </div>
        <span class="pill neutral">${preview?.count ?? 0} ${tr("previewed")}</span>
      </div>
      <div class="panel-body">
        <div class="form-grid">
          ${agentSelect("phoneTargetAgentId", "Target assignee", criteria.targetAgentId)}
          ${selectField("phoneStatus", "Conversation status", [["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"], ["snoozed", "Snoozed"], ["all", "All"]], criteria.status)}
          ${inboxSelect("phoneInboxId", "Inbox", criteria.inboxId)}
          ${inputField("phoneMaxPhones", "Phone scan limit", criteria.maxPhones || "100", "number")}
        </div>
        <label class="field span-all" for="phoneNumbersRaw">
          <span>${tr("Phone numbers / CSV content")}</span>
          <textarea id="phoneNumbersRaw" rows="8" placeholder="${tr("Paste one phone per line, or paste the CSV content with columns like Contact Name, Phone, Salesperson.")}">${escapeHtml(criteria.rawText || "")}</textarea>
        </label>
        <div class="form-grid">
          <label class="field" for="phoneFile">
            <span>${tr("Upload CSV or XLSX")}</span>
            <input id="phoneFile" type="file" accept=".csv,.txt,.xlsx">
          </label>
          <div class="file-status">
            <span>${tr("Selected file")}</span>
            <strong>${criteria.fileName ? escapeHtml(criteria.fileName) : tr("No file selected.")}</strong>
          </div>
        </div>
        <p class="notice">${tr("The app searches Chatwoot contacts by phone, then assigns the matching conversations only. Nothing changes before execution.")}</p>
        <p class="notice">${tr("This inbox is a source filter for existing conversations, not a destination. If a number has no conversation/contact in these filters, it will appear under Numbers not ready.")}</p>
        ${parse?.phoneCount ? `<p class="notice ok-note">${tr("File read: {count} phone number(s) found.", { count: parse.phoneCount })}</p>` : ""}
        <p class="notice warn">${tr("Only the first {count} numbers will be checked in this preview. Increase it after the first preview looks correct.", { count: criteria.maxPhones || 100 })}</p>
        <div class="actions sticky-actions">
          <button class="button" data-action="preview-phone-assign" ${isPreviewing ? "disabled" : ""}>${tr(isPreviewing ? "Previewing..." : "Preview phone matches")}</button>
          <button class="button danger" data-action="execute-phone-assign" ${preview?.count && !isPreviewing ? "" : "disabled"}>${tr("Execute phone assignment")}</button>
        </div>
      </div>
    </section>
    <div class="grid three" style="margin-top:16px">
      ${stat("phoneCount", preview?.phoneCount ?? parse?.phoneCount ?? "-")}
      ${stat("matchedPhoneCount", preview?.matchedPhoneCount ?? "-")}
      ${stat("Matched conversations", preview?.count ?? "-")}
    </div>
    ${phonePreviewTables()}
  `;
}

function phonePreviewTables() {
  if (!state.phonePreview) {
    return `<section class="panel" style="margin-top:16px"><div class="panel-body"><p class="notice">${tr("Preview first. The app will show exactly which conversations/customers are affected before it writes anything.")}</p></div></section>`;
  }
  const warnings = (state.phonePreview.warnings || []).map(item => `<p class="notice warn">${escapeHtml(item)}</p>`).join("");
  const matchedRows = state.phonePreview.items.slice(0, 150).map(localizePhoneRow);
  const missedRows = (state.phonePreview.misses || []).slice(0, 150).map(localizePhoneRow);
  return `
    ${warnings}
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Matched conversations")}</h2></div>
      <div class="panel-body">${simpleTable(matchedRows, ["inputPhone", "conversationId", "inboxName", "contactName", "status", "assigneeName", "targetAgentId", "matchStatus"])}</div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Numbers not ready")}</h2></div>
      <div class="panel-body">${simpleTable(missedRows, ["inputPhone", "normalizedPhone", "reason", "contactSearchMatches", "contactId", "contactName", "phoneNumber"])}</div>
    </section>
  `;
}

function localizePhoneRow(row) {
  return {
    ...row,
    matchStatus: row.matchStatus ? tr(row.matchStatus) : "",
    reason: row.reason ? tr(row.reason) : ""
  };
}

function localizeReplyRow(row) {
  return {
    ...row,
    needsReply: row.needsReply === undefined ? "" : tr(row.needsReply ? "Yes" : "No"),
    replyStatus: row.replyStatus ? tr(row.replyStatus) : "",
    lastMessageDirection: row.lastMessageDirection ? tr(row.lastMessageDirection) : ""
  };
}

function bulkView() {
  return actionsView();
}

function toggleLanguage() {
  state.lang = state.lang === "ar" ? "en" : "ar";
  localStorage.setItem("chatwootOpsLanguage", state.lang);
  const url = new URL(window.location.href);
  url.searchParams.set("lang", state.lang);
  window.history.replaceState(null, "", url);
  applyLocale();
  render();
}

function applyLocale() {
  const isArabic = state.lang === "ar";
  document.documentElement.lang = isArabic ? "ar" : "en";
  document.documentElement.dir = isArabic ? "rtl" : "ltr";
  document.body.classList.toggle("rtl", isArabic);
  const brandTitle = document.getElementById("brand-title");
  const brandSubtitle = document.getElementById("brand-subtitle");
  const refreshButton = document.getElementById("refresh-button");
  const languageToggle = document.getElementById("language-toggle");
  if (brandTitle) brandTitle.textContent = tr("Ops Console");
  if (brandSubtitle) brandSubtitle.textContent = tr("Bulk control for Chatwoot");
  if (refreshButton) refreshButton.textContent = tr("Refresh");
  if (languageToggle) {
    languageToggle.textContent = isArabic ? "English" : "العربية";
    languageToggle.title = isArabic ? "Switch to English" : "التحويل للعربية";
  }
}

function campaignsView() {
  return `
    <div class="grid two">
      <section class="panel">
        <div class="panel-header"><h2>${tr("Create Local Campaign Tracker")}</h2></div>
        <div class="panel-body">
          <div class="form-grid">
            ${inputField("campaignName", "Campaign name", "May outbound")}
            ${inputField("chatwootCampaignId", "Chatwoot campaign ID", "")}
            ${agentSelect("campaignOwnerId", "Owner / sales")}
            ${inputField("campaignAudience", "Audience note", "VIP label")}
          </div>
          <div class="actions"><button class="button" data-action="create-campaign">${tr("Create tracker")}</button></div>
          <p class="notice">${tr("Configure Chatwoot webhooks to call")} <strong>/api/webhooks/chatwoot</strong> ${tr("for message_created and message_updated events.")}</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>${tr("Webhook Events")}</h2><button class="button secondary" data-action="load-webhooks">${tr("Load events")}</button></div>
        <div class="panel-body">${simpleTable(state.webhooks.slice(0, 8), ["receivedAt", "event", "campaignId", "router.action", "router.reason", "router.fromAgentStatus", "router.toAgentName"])}</div>
      </section>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Campaigns")}</h2><button class="button secondary" data-action="load-campaigns">${tr("Refresh")}</button></div>
      <div class="panel-body">${simpleTable(state.campaigns, ["createdAt", "name", "chatwootCampaignId", "ownerName", "sentCount", "deliveredCount", "repliedCount", "failedCount"])}</div>
    </section>
  `;
}

function auditView() {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>${tr("Action Log")}</h2>
        <div class="actions" style="margin:0">
          <button class="button secondary" data-action="fetch-chatwoot-audit">${tr("Fetch Chatwoot audit")}</button>
          <button class="button secondary" data-action="load-audit">${tr("Refresh")}</button>
        </div>
      </div>
      <div class="panel-body">${simpleTable(state.audit, ["createdAt", "action", "summary", "actor.name", "metadata.jobId"])}</div>
    </section>
  `;
}

function exportsView() {
  return `
    <section class="panel">
      <div class="panel-header"><h2>${tr("CSV Downloads")}</h2></div>
      <div class="panel-body">
        <div class="actions">
          <a class="button secondary" href="/api/audit/export.csv">${tr("Audit CSV")}</a>
          <a class="button secondary" href="/api/campaigns/export.csv">${tr("Campaign CSV")}</a>
        </div>
        <h3>${tr("Bulk jobs")}</h3>
        ${jobsTable()}
      </div>
    </section>
  `;
}

function settingsView() {
  return `
    <div class="grid two">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>${tr("Chatwoot connection")}</h2>
            <p class="panel-note">${tr("These values can also live in Railway environment variables.")}</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="form-grid">
            ${inputField("baseUrl", "Chatwoot base URL", state.connection.baseUrl || "https://chatwoot.example.com")}
            ${inputField("accountId", "Account ID", state.connection.accountId || "1", "number")}
            ${inputField("apiToken", "User access token", state.connection.apiToken || "", "password")}
            ${inputField("operatorName", "Operator name", state.connection.operatorName || "Ops Admin")}
          </div>
          <div class="actions">
            <button class="button" data-action="save-settings">${tr("Save and test")}</button>
            <button class="button secondary" data-action="clear-settings">${tr("Clear local settings")}</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>${tr("Add it inside Chatwoot")}</h2></div>
        <div class="panel-body">
          <ol class="steps-list compact">
            <li><strong>${tr("Open Chatwoot")}</strong><span>${tr("Go to Settings -> Integrations -> Dashboard Apps.")}</span></li>
            <li><strong>${tr("Add app URL")}</strong><span>${tr("Paste your Railway public URL, then save.")}</span></li>
            <li><strong>${tr("Open any conversation")}</strong><span>${tr("A new tab appears in the conversation panel and sends context to this app.")}</span></li>
          </ol>
          <p class="notice">${tr("Keep OPS_PASSWORD enabled on Railway. Chatwoot will ask for the same username/password the first time the embedded tab opens.")}</p>
        </div>
      </section>
    </div>
  `;
}

function bindViewEvents() {
  document.querySelectorAll("[data-action]").forEach(element => {
    element.addEventListener("click", async event => {
      const action = event.currentTarget.dataset.action;
      let caughtError = null;
      try {
        await runAction(action);
      } catch (error) {
        caughtError = error;
      } finally {
        const hadLoadingAction = Boolean(state.loadingAction);
        state.loadingAction = "";
        if (hadLoadingAction) render();
      }
      if (caughtError) notify(caughtError.message || "Request failed", "bad");
    });
  });

  document.querySelectorAll("[data-quick-action]").forEach(element => {
    element.addEventListener("click", event => {
      selectQuickAction(event.currentTarget.dataset.quickAction);
    });
  });

  document.querySelectorAll("[data-open-tab]").forEach(element => {
    element.addEventListener("click", event => {
      state.tab = event.currentTarget.dataset.openTab;
      render();
      refreshActiveTab();
    });
  });

  const phoneRaw = document.getElementById("phoneNumbersRaw");
  if (phoneRaw) {
    phoneRaw.addEventListener("input", event => {
      state.phoneAssign.rawText = event.currentTarget.value;
      state.phoneParse = null;
      state.phonePreview = null;
    });
  }

  const phoneFile = document.getElementById("phoneFile");
  if (phoneFile) {
    phoneFile.addEventListener("change", event => handlePhoneFile(event.currentTarget.files?.[0]));
  }
}

async function runAction(action) {
  if (action === "save-settings") return saveSettings();
  if (action === "clear-settings") return clearSettings();
  if (action === "load-automation-settings") return loadAutomationSettings();
  if (action === "save-automation-settings") return saveAutomationSettings();
  if (action === "preview-bulk") return previewBulk();
  if (action === "execute-bulk") return executeBulk();
  if (action === "load-open-report") return loadOpenReport();
  if (action === "export-open-report") return exportOpenReport();
  if (action === "preview-phone-assign") return previewPhoneAssign();
  if (action === "execute-phone-assign") return executePhoneAssign();
  if (action === "load-reports") return loadReports();
  if (action === "load-analytics") return loadAnalytics();
  if (action === "export-analytics") return exportAnalytics();
  if (action === "load-audit") return loadAudit();
  if (action === "fetch-chatwoot-audit") return fetchChatwootAudit();
  if (action === "create-campaign") return createCampaign();
  if (action === "load-campaigns") return loadCampaigns();
  if (action === "load-webhooks") return loadWebhooks();
  if (action === "request-context") return requestDashboardContext();
}

async function refreshBaseData() {
  if (!hasConnection()) return;
  try {
    const data = await api("/api/chatwoot/probe", { connection: state.connection });
    state.agents = data.agents || [];
    state.teams = data.teams || [];
    state.inboxes = data.inboxes || [];
    state.metrics = { conversationMetrics: data.metrics };
    render();
  } catch (error) {
    notify(error.message, "bad");
  }
}

async function loadAutomationSettings({ quiet = false } = {}) {
  const data = await getJson("/api/automation-settings");
  state.automationSettings = data.settings || defaultClientAutomationSettings();
  state.automationSettingsMeta = {
    saved: Boolean(data.saved),
    updatedAt: data.updatedAt || null
  };
  render();
  if (!quiet) notify(tr("Automation settings loaded."), "ok");
}

async function saveAutomationSettings() {
  const actor = state.appContext?.currentAgent || { name: state.connection.operatorName || "Ops Admin" };
  const data = await api("/api/automation-settings", {
    settings: getAutomationSettingsFromForm(),
    actor
  });
  state.automationSettings = data.settings || defaultClientAutomationSettings();
  state.automationSettingsMeta = {
    saved: Boolean(data.saved),
    updatedAt: data.updatedAt || null
  };
  render();
  notify(tr("Automation settings saved."), "ok");
}

function getAutomationSettingsFromForm() {
  return {
    department: {
      enabled: checked("automationDepartmentEnabled"),
      inboxIds: checkedValues("automationInboxIds"),
      salesTeamId: value("automationSalesTeamId"),
      operationsTeamId: value("automationOperationsTeamId"),
      salesAgentIds: checkedValues("automationSalesAgentIds"),
      operationsAgentIds: checkedValues("automationOperationsAgentIds"),
      promptOnNew: checked("automationPromptOnNew"),
      promptOnResolved: checked("automationPromptOnResolved"),
      newContactsOnly: checked("automationNewContactsOnly"),
      skipCampaigns: checked("automationSkipCampaigns"),
      assignAgent: checked("automationAssignAgent"),
      confirmSelection: checked("automationConfirmSelection"),
      businessHoursEnabled: checked("automationBusinessHoursEnabled"),
      businessTimezone: value("automationBusinessTimezone"),
      businessStart: value("automationBusinessStart"),
      businessEnd: value("automationBusinessEnd"),
      businessDays: checkedValues("automationBusinessDays"),
      salesAssignmentMode: value("automationSalesAssignmentMode"),
      complaintAgentId: value("automationComplaintAgentId"),
      complaintAgentEmail: value("automationComplaintAgentEmail"),
      complaintAgentName: value("automationComplaintAgentName"),
      promptText: value("automationPromptText"),
      salesConfirmationText: value("automationSalesConfirmationText"),
      operationsConfirmationText: value("automationOperationsConfirmationText"),
      operationsDataPromptText: value("automationOperationsDataPromptText"),
      complaintIntroText: value("automationComplaintIntroText"),
      complaintDataPromptText: value("automationComplaintDataPromptText"),
      complaintReceivedText: value("automationComplaintReceivedText"),
      rerouteUnavailableManualAssignments: checked("automationRerouteUnavailableManual"),
      manualAssignmentUnavailableStatuses: listValue("automationManualUnavailableStatuses"),
      unavailableManualFallback: value("automationUnavailableManualFallback")
    },
    reopen: {
      enabled: checked("automationReopenEnabled"),
      inboxIds: checkedValues("automationReopenInboxIds"),
      teamId: value("automationReopenTeamId"),
      agentIds: checkedValues("automationReopenAgentIds"),
      unavailableStatuses: listValue("automationReopenStatuses"),
      fallback: value("automationReopenFallback"),
      assignUnassigned: checked("automationReopenAssignUnassigned"),
      cooldownSeconds: Number(value("automationReopenCooldown") || 60),
      skipCampaigns: checked("automationReopenSkipCampaigns")
    },
    botpress: {
      enabled: checked("automationBotpressEnabled"),
      skipBroadcasts: checked("automationBotpressSkipBroadcasts"),
      requireResolvedReentry: checked("automationBotpressRequireResolvedReentry"),
      workingHoursEnabled: checked("automationBotpressWorkingHoursEnabled"),
      timezone: value("automationBotpressTimezone"),
      start: value("automationBotpressStart"),
      end: value("automationBotpressEnd"),
      days: checkedValues("automationBotpressDays"),
      inHoursQueueMessage: value("automationBotpressInHoursQueueMessage"),
      outsideHoursMessage: value("automationBotpressOutsideHoursMessage"),
      outsideHoursMode: "send_message"
    }
  };
}

async function refreshActiveTab() {
  if (state.tab === "open_report") return loadOpenReport();
  if (state.tab === "automation") return loadAutomationSettings();
  if (state.tab === "dashboard") return loadReports();
  if (state.tab === "analytics") return loadAnalytics();
  if (state.tab === "audit") return loadAudit();
  if (state.tab === "campaigns") return Promise.all([loadCampaigns(), loadWebhooks()]);
  if (state.tab === "exports") return loadJobs();
}

function selectQuickAction(id) {
  const preset = quickActions[id];
  if (!preset) return;

  state.preview = null;
  state.bulkCriteria = {
    ...state.bulkCriteria,
    scope: preset.scope,
    action: preset.action || id,
    targetTeamId: id === "assign_team" ? state.bulkCriteria.targetTeamId : "",
    targetAgentId: id === "assign_agent" || id === "contact_owner" ? state.bulkCriteria.targetAgentId : "",
    includeContactConversations: id === "contact_owner" ? state.bulkCriteria.includeContactConversations : false
  };
  render();
}

async function loadReports() {
  if (!hasConnection()) return notify(tr("Save Chatwoot connection first."), "warn");
  const data = await api("/api/reports/summary", { connection: state.connection });
  state.metrics = data;
  render();
}

async function loadOpenReport() {
  if (!hasConnection()) return notify(tr("Save Chatwoot connection first."), "warn");
  const criteria = {
    inboxIds: checkedValues("reportInboxIds"),
    agentIds: checkedValues("reportAgentIds"),
    unreadOnly: Boolean(document.getElementById("reportUnreadOnly")?.checked),
    includeReplyStatus: Boolean(document.getElementById("reportIncludeReplyStatus")?.checked || document.getElementById("reportNeedsReplyOnly")?.checked),
    needsReplyOnly: Boolean(document.getElementById("reportNeedsReplyOnly")?.checked),
    replyCheckLimit: Number(value("reportReplyCheckLimit") || 100),
    maxPages: Number(value("reportMaxPages") || 20)
  };
  state.openReportCriteria = criteria;
  state.openReport = await api("/api/conversations/open-report", {
    connection: state.connection,
    criteria
  });
  render();
}

function exportOpenReport() {
  if (!state.openReport?.conversations?.length) {
    return notify(tr("No report to download."), "warn");
  }

  const rows = openReportExportRows(state.openReport);
  const fileName = `chatwoot-open-report-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsv(fileName, rows);
  notify(tr("Report CSV downloaded."), "ok");
}

function openReportExportRows(report) {
  return (report.conversations || []).map(row => ({
    conversationId: row.conversationId,
    inboxName: row.inboxName,
    inboxId: row.inboxId,
    contactDisplay: row.contactDisplay,
    contactName: row.contactName,
    phoneNumber: row.phoneNumber,
    contactId: row.contactId,
    assigneeName: row.assigneeName,
    assigneeId: row.assigneeId,
    status: row.status,
    unreadCount: row.unreadCount,
    replyStatus: row.replyStatus ? tr(row.replyStatus) : "",
    needsReply: row.needsReply === undefined ? "" : tr(row.needsReply ? "Yes" : "No"),
    lastCustomerMessageAt: row.lastCustomerMessageAt || "",
    lastSalesReplyAt: row.lastSalesReplyAt || "",
    lastSalesReplyBy: row.lastSalesReplyBy || "",
    source: row.source
  }));
}

function analyticsView() {
  const report = state.analytics;
  const csat = report?.csat || {};
  const leads = report?.leadSources || {};
  const filters = state.analyticsFilters || {};
  const warnings = (report?.warnings || []).map(item => `<p class="notice warn">${escapeHtml(item)}</p>`).join("");
  const distribution = csat.distribution || {};
  const distRows = Object.keys(distribution)
    .sort((a, b) => Number(a) - Number(b))
    .map(rating => ({ rating, count: distribution[rating] }));
  const sourceRows = (leads.bySource || []).map(row => ({
    source: row.label,
    count: row.count,
    share: `${row.percentage}%`
  }));
  const agentRows = (report?.agents || []).map(row => ({
    agentName: row.agentName,
    ratedCount: row.ratedCount ?? 0,
    averageRating: row.averageRating ?? "-",
    conversationsCount: row.conversationsCount ?? "-",
    resolutionsCount: row.resolutionsCount ?? "-",
    avgFirstResponseTime: formatDuration(row.avgFirstResponseTime),
    avgResolutionTime: formatDuration(row.avgResolutionTime)
  }));
  const teamRows = (report?.teams || []).map(row => ({
    teamName: row.teamName,
    conversationsCount: row.conversationsCount ?? "-",
    resolutionsCount: row.resolutionsCount ?? "-",
    avgFirstResponseTime: formatDuration(row.avgFirstResponseTime),
    avgResolutionTime: formatDuration(row.avgResolutionTime)
  }));

  return `
    ${embeddedBanner()}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>${tr("Analytics")}</h2>
          <p class="panel-note">${tr("Lead sources and satisfaction come from this app's durable log; agent and team timings come live from Chatwoot reporting.")}</p>
        </div>
      </div>
      <div class="panel-body">
        <div class="form-grid">
          ${inputField("analyticsSince", "From date", filters.since || "", "date")}
          ${inputField("analyticsUntil", "To date", filters.until || "", "date")}
          ${inboxSelect("analyticsInboxId", "Inbox", filters.inboxId || "")}
        </div>
        <p class="notice">${tr("Leave the dates empty to report on the last 30 days.")}</p>
        <div class="actions">
          <button class="button" data-action="load-analytics">${tr("Run analytics")}</button>
          <button class="button secondary" data-action="export-analytics" ${report ? "" : "disabled"}>${tr("Download analytics CSV")}</button>
        </div>
      </div>
    </section>
    ${warnings}
    <div class="grid three" style="margin-top:16px">
      ${stat("Customers surveyed", csat.ratedCount ?? "-")}
      ${stat("Average rating", csat.averageRating ?? "-")}
      ${stat("Total leads", leads.total ?? "-")}
    </div>
    <div class="grid two" style="margin-top:16px">
      <section class="panel">
        <div class="panel-header"><h2>${tr("Rating distribution")}</h2></div>
        <div class="panel-body">${simpleTable(distRows, ["rating", "count"])}</div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>${tr("Leads by source")}</h2></div>
        <div class="panel-body">${simpleTable(sourceRows, ["source", "count", "share"])}</div>
      </section>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Per-agent satisfaction & response")}</h2></div>
      <div class="panel-body">${simpleTable(agentRows, ["agentName", "ratedCount", "averageRating", "conversationsCount", "resolutionsCount", "avgFirstResponseTime", "avgResolutionTime"])}</div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h2>${tr("Per-team performance")}</h2></div>
      <div class="panel-body">${simpleTable(teamRows, ["teamName", "conversationsCount", "resolutionsCount", "avgFirstResponseTime", "avgResolutionTime"])}</div>
    </section>
  `;
}

async function loadAnalytics() {
  if (!hasConnection()) return notify(tr("Save Chatwoot connection first."), "warn");
  const filters = {
    since: value("analyticsSince") || "",
    until: value("analyticsUntil") || "",
    inboxId: value("analyticsInboxId") || ""
  };
  state.analyticsFilters = { ...filters };
  state.analytics = await api("/api/reports/analytics", { connection: state.connection, filters });
  render();
}

function exportAnalytics() {
  if (!state.analytics) return notify(tr("No analytics to download."), "warn");
  const rows = analyticsExportRows(state.analytics);
  const fileName = `chatwoot-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsv(fileName, rows);
  notify(tr("Analytics CSV downloaded."), "ok");
}

function analyticsExportRows(report) {
  const rows = [];
  for (const source of report.leadSources?.bySource || []) {
    rows.push({ section: "lead_source", name: source.label, value: source.value, count: source.count, percentage: source.percentage });
  }
  const distribution = report.csat?.distribution || {};
  for (const rating of Object.keys(distribution).sort((a, b) => Number(a) - Number(b))) {
    rows.push({ section: "csat_rating", name: rating, count: distribution[rating] });
  }
  for (const agent of report.agents || []) {
    rows.push({
      section: "agent",
      name: agent.agentName,
      id: agent.agentId,
      ratedCount: agent.ratedCount ?? 0,
      averageRating: agent.averageRating ?? "",
      conversationsCount: agent.conversationsCount ?? "",
      resolutionsCount: agent.resolutionsCount ?? "",
      avgFirstResponseTimeSeconds: agent.avgFirstResponseTime ?? "",
      avgResolutionTimeSeconds: agent.avgResolutionTime ?? ""
    });
  }
  for (const team of report.teams || []) {
    rows.push({
      section: "team",
      name: team.teamName,
      id: team.teamId,
      conversationsCount: team.conversationsCount ?? "",
      resolutionsCount: team.resolutionsCount ?? "",
      avgFirstResponseTimeSeconds: team.avgFirstResponseTime ?? "",
      avgResolutionTimeSeconds: team.avgResolutionTime ?? ""
    });
  }
  return rows;
}

function formatDuration(seconds) {
  if (seconds == null || seconds === "" || Number.isNaN(Number(seconds))) return "-";
  let remaining = Math.round(Number(seconds));
  if (remaining <= 0) return "0s";
  const hours = Math.floor(remaining / 3600);
  remaining -= hours * 3600;
  const minutes = Math.floor(remaining / 60);
  remaining -= minutes * 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (remaining || parts.length === 0) parts.push(`${remaining}s`);
  return parts.join(" ");
}

async function handlePhoneFile(file) {
  if (!file) return;
  const buffer = await file.arrayBuffer();
  state.phoneAssign.fileName = file.name;
  state.phoneAssign.fileBase64 = arrayBufferToBase64(buffer);
  if (/\.(csv|txt)$/i.test(file.name)) {
    state.phoneAssign.rawText = await file.text();
  }
  state.phonePreview = null;
  state.phoneParse = null;
  render();
  try {
    state.phoneParse = await parsePhoneAssignInput();
    render();
    notify(tr("File read: {count} phone number(s) found.", { count: state.phoneParse.phoneCount || 0 }), state.phoneParse.phoneCount ? "ok" : "warn");
  } catch {
    notify(tr("Could not read phone numbers from this file."), "bad");
  }
}

async function parsePhoneAssignInput() {
  return api("/api/phone-assign/parse", {
    criteria: {
      rawText: state.phoneAssign.rawText || "",
      fileName: state.phoneAssign.fileName || "",
      fileBase64: state.phoneAssign.fileBase64 || ""
    }
  });
}

async function previewPhoneAssign() {
  if (!hasConnection()) return notify(tr("Save Chatwoot connection first."), "warn");
  const criteria = getPhoneAssignCriteria();
  state.phoneAssign = criteria;
  state.phonePreview = null;

  if (!criteria.targetAgentId) return notify(tr("Choose the target agent first."), "warn");
  if (!criteria.rawText.trim() && !criteria.fileBase64) return notify(tr("Add a CSV/XLSX file or paste phone numbers first."), "warn");

  if (!state.phoneParse) {
    state.phoneParse = await parsePhoneAssignInput();
  }
  state.loadingAction = "preview-phone-assign";
  render();
  const data = await api("/api/phone-assign/preview", { connection: state.connection, criteria });
  state.phonePreview = data;
  state.loadingAction = "";
  render();
  notify(tr("Phone preview finished: {matched}/{phones} phone(s) matched.", {
    matched: data.matchedPhoneCount || 0,
    phones: data.phoneCount || 0
  }), data.count ? "ok" : "warn");
}

async function executePhoneAssign() {
  if (!state.phonePreview?.items?.length) return;
  const actor = state.appContext?.currentAgent || { name: state.connection.operatorName || "Ops Admin" };
  const criteria = state.phonePreview.criteria || getPhoneAssignCriteria();
  const confirmed = window.confirm(tr("Execute assignment for {count} conversation(s)?", { count: state.phonePreview.items.length }));
  if (!confirmed) return;
  const job = await api("/api/phone-assign/execute", {
    connection: state.connection,
    criteria,
    items: state.phonePreview.items,
    actor
  });
  state.phonePreview = null;
  await loadJobs();
  notify(tr("Phone assignment finished: {succeeded}/{total} succeeded.", { succeeded: job.succeeded, total: job.total }), job.failed ? "warn" : "ok");
  state.tab = "exports";
  render();
}

async function previewBulk() {
  if (!hasConnection()) return notify(tr("Save Chatwoot connection first."), "warn");
  const criteria = getBulkCriteria();
  state.bulkCriteria = criteria;
  const data = await api("/api/bulk/preview", { connection: state.connection, criteria });
  state.preview = data;
  render();
}

async function executeBulk() {
  if (!state.preview?.items?.length) return;
  const criteria = state.preview.criteria || getBulkCriteria();
  const actor = state.appContext?.currentAgent || { name: state.connection.operatorName || "Ops Admin" };
  const confirmed = window.confirm(tr("Execute {action} on {count} item(s)?", { action: criteria.action, count: state.preview.items.length }));
  if (!confirmed) return;
  const job = await api("/api/bulk/execute", {
    connection: state.connection,
    criteria,
    items: state.preview.items,
    actor
  });
  state.preview = null;
  await loadJobs();
  notify(tr("Bulk job finished: {succeeded}/{total} succeeded.", { succeeded: job.succeeded, total: job.total }), job.failed ? "warn" : "ok");
  state.tab = "exports";
  render();
}

async function saveSettings() {
  state.connection = {
    baseUrl: value("baseUrl"),
    accountId: value("accountId"),
    apiToken: value("apiToken"),
    operatorName: value("operatorName")
  };
  localStorage.setItem("chatwootOpsConnection", JSON.stringify(state.connection));
  await refreshBaseData();
  notify(tr("Connection saved locally."), "ok");
}

function clearSettings() {
  localStorage.removeItem("chatwootOpsConnection");
  state.connection = {};
  state.agents = [];
  state.teams = [];
  state.inboxes = [];
  state.metrics = null;
  render();
}

async function loadAudit() {
  state.audit = await getJson("/api/audit");
  render();
}

async function fetchChatwootAudit() {
  if (!hasConnection()) return notify(tr("Save Chatwoot connection first."), "warn");
  const data = await api("/api/chatwoot/audit", {
    connection: state.connection,
    actor: state.appContext?.currentAgent || { name: state.connection.operatorName || "Ops Admin" }
  });
  notify(tr("Fetched {count} Enterprise audit rows.", { count: data.audit_logs?.length || 0 }), "ok");
  await loadAudit();
}

async function loadJobs() {
  state.jobs = await getJson("/api/jobs");
  render();
}

async function loadCampaigns() {
  state.campaigns = await getJson("/api/campaigns");
  render();
}

async function loadWebhooks() {
  state.webhooks = await getJson("/api/webhooks");
  render();
}

async function createCampaign() {
  const owner = state.agents.find(agent => String(agent.id) === String(value("campaignOwnerId")));
  await api("/api/campaigns", {
    name: value("campaignName"),
    chatwootCampaignId: value("chatwootCampaignId"),
    ownerId: value("campaignOwnerId"),
    ownerName: owner?.name || "",
    audience: value("campaignAudience"),
    actor: state.appContext?.currentAgent || { name: state.connection.operatorName || "Ops Admin" }
  });
  await loadCampaigns();
}

function getBulkCriteria() {
  const scope = value("scope");
  let action = value("action");
  if (scope === "contacts" && action === "assign_team") action = "assign_agent";

  return {
    scope,
    status: value("status"),
    inboxId: value("inboxId"),
    fromAgentId: value("fromAgentId"),
    action,
    targetAgentId: value("targetAgentId"),
    targetTeamId: value("targetTeamId"),
    ownerAttribute: value("ownerAttribute") || "sales_owner_id",
    ownerValue: value("fromAgentId"),
    includeContactConversations: Boolean(document.getElementById("includeContactConversations")?.checked),
    unreadOnly: Boolean(document.getElementById("unreadOnly")?.checked),
    maxPages: Number(value("maxPages") || 20)
  };
}

function getPhoneAssignCriteria() {
  return {
    rawText: value("phoneNumbersRaw"),
    fileName: state.phoneAssign.fileName || "",
    fileBase64: state.phoneAssign.fileBase64 || "",
    status: value("phoneStatus") || "open",
    inboxId: value("phoneInboxId"),
    targetAgentId: value("phoneTargetAgentId"),
    maxPhones: Number(value("phoneMaxPhones") || 2000)
  };
}

function bindDashboardAppContext() {
  window.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.event === "appContext") {
        state.appContext = parsed.data;
        document.body.classList.add("embedded");
        renderContextBox();
      }
    } catch {
      // Ignore non-JSON dashboard messages.
    }
  });
}

function setEmbeddedMode() {
  try {
    document.body.classList.toggle("embedded", window.parent !== window);
  } catch {
    document.body.classList.add("embedded");
  }
}

function loadLanguage() {
  const requested = new URLSearchParams(window.location.search).get("lang");
  if (requested === "ar" || requested === "en") return requested;
  const saved = localStorage.getItem("chatwootOpsLanguage");
  return saved === "ar" ? "ar" : "en";
}

function tr(text, values = {}) {
  const translated = state.lang === "ar" ? translations.ar[text] || text : text;
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{${key}}`, String(value)),
    translated
  );
}

function requestDashboardContext() {
  window.parent?.postMessage("chatwoot-dashboard-app:fetch-info", "*");
  notify(tr("Requested Chatwoot dashboard context."), "neutral");
}

function renderContextBox() {
  const box = document.getElementById("dashboard-context");
  if (!box) return;
  const agent = state.appContext?.currentAgent;
  const contact = state.appContext?.contact;
  const conversation = state.appContext?.conversation;
  box.innerHTML = agent || contact || conversation
    ? `<strong>${tr("Dashboard context")}</strong><br>${tr("Agent")}: ${escapeHtml(agent?.name || "-")}<br>${tr("contactName")}: ${escapeHtml(contact?.name || "-")}<br>${tr("conversationId")}: ${conversation?.id || "-"}`
    : `<strong>${tr("Dashboard context")}</strong><br><span>${tr("No embedded context received.")}</span>`;
}

function reportsTable() {
  const reports = state.metrics?.reports || {};
  const rows = Object.entries(reports).map(([metric, value]) => ({
    metric,
    points: Array.isArray(value) ? value.length : "-",
    status: value?.error ? value.error : "ok"
  }));
  return simpleTable(rows, ["metric", "points", "status"]);
}

function contextDetails() {
  if (!state.appContext) return `<p class="notice">${tr("Open this app as a Chatwoot Dashboard App to receive conversation, contact, and currentAgent context.")}</p>`;
  return `<pre>${escapeHtml(JSON.stringify(state.appContext, null, 2))}</pre>`;
}

function previewTable() {
  if (!state.preview) return `<p class="notice">${tr("Preview first. The app will show exactly which conversations/customers are affected before it writes anything.")}</p>`;
  const warnings = (state.preview.warnings || []).map(item => `<p class="notice warn">${escapeHtml(item)}</p>`).join("");
  const emptyHint = state.preview.count === 0
    ? `<p class="notice warn">${tr("No rows matched these filters. Try Status = All, remove the inbox filter, or confirm the current assignee/owner is correct.")}</p>`
    : "";
  return `${warnings}${emptyHint}${simpleTable(state.preview.items.slice(0, 100), ["type", "conversationId", "inboxName", "inboxId", "contactId", "contactName", "unreadCount", "status", "assigneeName", "source"])}`;
}

function embeddedBanner() {
  const agent = state.appContext?.currentAgent;
  const contact = state.appContext?.contact;
  const conversation = state.appContext?.conversation;
  if (agent || contact || conversation) {
    return `
      <section class="embed-banner connected">
        <div>
          <strong>${tr("Running inside Chatwoot")}</strong>
          <span>${tr("Agent")}: ${escapeHtml(agent?.name || "-")} - ${tr("contactName")}: ${escapeHtml(contact?.name || "-")} - ${tr("conversationId")}: ${conversation?.id || "-"}</span>
        </div>
        <button class="button secondary" data-action="request-context">${tr("Refresh context")}</button>
      </section>
    `;
  }

  return `
    <section class="embed-banner">
      <div>
        <strong>${tr("Standalone mode")}</strong>
        <span>${tr("It works from Railway now. To make it feel native in Chatwoot, add this URL as a Dashboard App.")}</span>
      </div>
      <button class="button secondary" data-open-tab="settings">${tr("Setup guide")}</button>
    </section>
  `;
}

function workflowSteps() {
  const hasPreview = Boolean(state.preview?.count);
  return `
    <div class="workflow">
      <span class="done">${tr("1. Action")}</span>
      <span class="done">${tr("2. Filters")}</span>
      <span class="${hasPreview ? "done" : ""}">${tr("3. Preview")}</span>
      <span>${tr("4. Execute")}</span>
    </div>
  `;
}

function actionForm(criteria) {
  const isContacts = criteria.scope === "contacts";
  const action = isContacts && criteria.action === "assign_team" ? "assign_agent" : criteria.action;
  const actionOptions = isContacts
    ? [["assign_agent", "Transfer owner"], ["unassign", "Remove owner"]]
    : [["assign_agent", "Transfer to agent"], ["assign_team", "Move to team"], ["unassign", "Remove assignee"]];
  const isTeam = action === "assign_team";
  const isUnassign = action === "unassign";
  const showUnreadOption = !isContacts || criteria.includeContactConversations;
  return `
    <div class="form-grid action-form">
      ${selectField("scope", "What should be changed?", [["conversations", "Conversations"], ["contacts", "Customer owner field"]], criteria.scope)}
      ${selectField("status", "Conversation status", [["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"], ["snoozed", "Snoozed"], ["all", "All"]], criteria.status)}
      ${!isContacts ? inboxSelect("inboxId", "Inbox", criteria.inboxId) : ""}
      ${agentSelect("fromAgentId", isContacts ? "Current owner / from sales" : "Current assignee", criteria.fromAgentId)}
      ${selectField("action", "Action", actionOptions, action)}
      ${!isUnassign && !isTeam ? agentSelect("targetAgentId", isContacts ? "New owner / to sales" : "New assignee", criteria.targetAgentId) : ""}
      ${isTeam ? teamSelect("targetTeamId", "Target team", criteria.targetTeamId) : ""}
      ${isContacts ? inputField("ownerAttribute", "Owner custom attribute", criteria.ownerAttribute || "sales_owner_id") : ""}
      ${inputField("maxPages", "Search limit: Chatwoot API pages", criteria.maxPages || "20", "number")}
    </div>
    ${isContacts ? `
      <label class="field checkbox-field">
        <span><input type="checkbox" id="includeContactConversations" ${criteria.includeContactConversations ? "checked" : ""}> ${tr("Also reassign conversations for these customers")}</span>
      </label>
    ` : `<input type="checkbox" id="includeContactConversations" hidden ${criteria.includeContactConversations ? "checked" : ""}>`}
    ${showUnreadOption ? `
      <label class="field checkbox-field">
        <span><input type="checkbox" id="unreadOnly" ${criteria.unreadOnly ? "checked" : ""}> ${tr("Only unread conversations")}</span>
      </label>
    ` : ""}
    <p class="notice">${tr(isContacts ? "Customer owner mode only finds contacts that already have this custom attribute. If you never filled sales_owner_id, preview can be zero." : "Conversation mode finds conversations assigned to the selected agent. Use this for moving chats from one employee to another.")}</p>
    <p class="notice">${tr("Chatwoot sends results in pages. 20 means scan up to 20 API pages, then stop for safety. This does not execute anything.")}</p>
    ${showUnreadOption ? `<p class="notice">${tr("Unread filtering is applied locally after Chatwoot returns conversations, so increase the page limit if you expect many open conversations.")}</p>` : ""}
  `;
}

function jobsTable() {
  return simpleTable(state.jobs, ["createdAt", "action", "total", "succeeded", "failed", "id"], row => (
    `<a href="/api/jobs/${row.id}/export.csv">${tr("Download")}</a>`
  ));
}

function simpleTable(rows, keys, extraCell) {
  if (!rows || rows.length === 0) return `<p class="notice">${tr("No rows yet.")}</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${keys.map(key => `<th>${tr(key)}</th>`).join("")}${extraCell ? `<th>${tr("Exports")}</th>` : ""}</tr></thead>
        <tbody>
          ${rows.map(row => `<tr>${keys.map(key => `<td>${escapeHtml(readPath(row, key) ?? "")}</td>`).join("")}${extraCell ? `<td>${extraCell(row)}</td>` : ""}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function downloadCsv(fileName, rows) {
  const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  if (!rows || rows.length === 0) return "";
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return [
    headers.join(","),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(","))
  ].join("\n");
}

function csvCell(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function stat(label, value) {
  return `<section class="panel stat"><span>${tr(label)}</span><strong>${escapeHtml(value)}</strong></section>`;
}

function checkboxGroup(name, label, options, selected = []) {
  const selectedSet = new Set((selected || []).map(String));
  const rows = options.length
    ? options.map(([value, text]) => `
      <label class="check-row">
        <input type="checkbox" name="${name}" value="${escapeHtml(value)}" ${selectedSet.has(String(value)) ? "checked" : ""}>
        <span>${escapeHtml(text)}</span>
      </label>
    `).join("")
    : `<p class="notice">${tr("No rows yet.")}</p>`;
  return `
    <section class="check-panel">
      <div class="check-header">
        <strong>${tr(label)}</strong>
        <span>${tr("Leave empty to include all.")}</span>
      </div>
      <div class="check-list">${rows}</div>
    </section>
  `;
}

function inputField(id, label, defaultValue = "", type = "text") {
  const translatedDefault = state.lang === "ar" ? tr(defaultValue) : defaultValue;
  return `<label class="field" for="${id}"><span>${tr(label)}</span><input id="${id}" type="${type}" value="${escapeHtml(translatedDefault)}"></label>`;
}

function textareaField(id, label, defaultValue = "") {
  const translatedDefault = state.lang === "ar" ? tr(defaultValue || "") : (defaultValue || "");
  return `<label class="field" for="${id}"><span>${tr(label)}</span><textarea id="${id}" rows="5">${escapeHtml(translatedDefault)}</textarea></label>`;
}

function selectField(id, label, options, selected = "") {
  return `<label class="field" for="${id}"><span>${tr(label)}</span><select id="${id}">${options.map(([value, text]) => `<option value="${value}" ${String(value) === String(selected || "") ? "selected" : ""}>${tr(text)}</option>`).join("")}</select></label>`;
}

function agentSelect(id, label, selected = "") {
  const options = [["", "Select agent"], ...state.agents.map(agent => [agent.id, `${agent.name} (${agent.email})`])];
  return selectField(id, label, options, selected);
}

function teamSelect(id, label, selected = "") {
  const options = [["", "Select team"], ...state.teams.map(team => [team.id, team.name])];
  return selectField(id, label, options, selected);
}

function inboxSelect(id, label, selected = "") {
  const options = [["", "All inboxes"], ...state.inboxes.map(inbox => [inbox.id, `${inbox.name} (${inbox.channel_type || inbox.channelType || "inbox"})`])];
  return selectField(id, label, options, selected);
}

function checkboxPanel(items) {
  return `
    <section class="check-panel">
      <div class="check-list no-max">
        ${items.map(([id, label, isChecked]) => `
          <label class="check-row">
            <input id="${id}" type="checkbox" ${isChecked ? "checked" : ""}>
            <span>${tr(label)}</span>
          </label>
        `).join("")}
      </div>
    </section>
  `;
}

function dayCheckboxGroup(name, label, selected = []) {
  return checkboxGroup(name, label, [
    ["0", "Sunday"],
    ["1", "Monday"],
    ["2", "Tuesday"],
    ["3", "Wednesday"],
    ["4", "Thursday"],
    ["5", "Friday"],
    ["6", "Saturday"]
  ], selected);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function getJson(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function loadConnection() {
  try {
    return JSON.parse(localStorage.getItem("chatwootOpsConnection") || "{}");
  } catch {
    return {};
  }
}

function hasConnection() {
  return Boolean(state.connection.baseUrl && state.connection.accountId && state.connection.apiToken);
}

function value(id) {
  return document.getElementById(id)?.value || "";
}

function checked(id) {
  return Boolean(document.getElementById(id)?.checked);
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
}

function listValue(id) {
  return value(id)
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function defaultClientAutomationSettings() {
  return {
    department: {
      enabled: false,
      inboxIds: [],
      salesTeamId: "",
      operationsTeamId: "",
      salesAgentIds: [],
      operationsAgentIds: [],
      promptOnNew: true,
      promptOnResolved: true,
      newContactsOnly: true,
      skipCampaigns: true,
      assignAgent: true,
      confirmSelection: true,
      businessHoursEnabled: false,
      businessTimezone: "Africa/Cairo",
      businessStart: "09:00",
      businessEnd: "22:00",
      businessDays: ["0", "1", "2", "3", "4", "5", "6"],
      salesAssignmentMode: "online",
      complaintAgentId: "",
      complaintAgentEmail: "",
      complaintAgentName: "Abdelrahman Tarek",
      promptText: "للمبيعات و العروض الجديدة اضغط 1\nلدعم المتدربين اضغط 2\nللشكاوي اضغط 3",
      salesConfirmationText: "سيتم التواصل معكم سريعا\nنقدر صبرك",
      operationsConfirmationText: "تم تحويل محادثتك إلى فريق العمليات، وسيتم الرد عليك في أقرب وقت.",
      operationsDataPromptText: "لتتمكن من مساعدتكم سريعا يرجى تزويدنا بالبيانات التالية\n1. الاسم الثلاثي\n2. رقم الهاتف الذي تم التسجيل به\n3. الدورة التي تم حجزها",
      complaintIntroText: "يرجى العلم أن هذا الاختيار يتعلق بالشكاوي فقط و سيتم الرد عليكم من 48 إلى 72 ساعة عمل\nو في حالة إن أردتم حل مشكلة متعلقة بالدورة يرجى اختيار دعم المتدربين و ذلك للرد الفوري\nلدعم المتدربين اضغط 1\nلتأكيد اختيار قسم الشكاوي اضغط 2",
      complaintDataPromptText: "يرجى تزويدنا بالبيانات التالية\n1. الاسم الثلاثي\n2. رقم الهاتف الذي تم التسجيل به\n3. الدورة التي تم حجزها\n4. ملخص الشكوى",
      complaintReceivedText: "تم إستلام الشكوى و سيتم الرد عليكم من 48 إلى 72 ساعة عمل",
      rerouteUnavailableManualAssignments: false,
      manualAssignmentUnavailableStatuses: ["offline", "busy", "away", "unavailable", "missing"],
      unavailableManualFallback: "unassign"
    },
    reopen: {
      enabled: false,
      inboxIds: [],
      teamId: "",
      agentIds: [],
      unavailableStatuses: ["offline", "busy", "away", "unavailable", "missing"],
      fallback: "unassign",
      assignUnassigned: true,
      cooldownSeconds: 60,
      skipCampaigns: true
    },
    botpress: {
      enabled: false,
      skipBroadcasts: true,
      requireResolvedReentry: true,
      workingHoursEnabled: true,
      timezone: "Africa/Cairo",
      start: "10:00",
      end: "21:00",
      days: ["0", "1", "2", "3", "4", "6"],
      outsideHoursMode: "send_message",
      inHoursQueueMessage: "سيتم التواصل معكم في أقرب وقت.\nنقدر صبركم.",
      outsideHoursMessage: "شكراً لتواصلكم معنا،\n\nحالياً أنتم تتواصلون خارج أوقات العمل الرسمية، والتي تمتد من 10:00 صباحاً حتى 9:00 مساءً طوال أيام الأسبوع ما عدا الجمعة.\n\nتم استلام رسالتكم وسيقوم أحد أعضاء فريقنا بالتواصل معكم في أقرب وقت ممكن خلال ساعات العمل.\n\nمع خالص التقدير،\n\nفريق تشغيل إنجوسوفت"
    }
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function readPath(row, path) {
  return path.split(".").reduce((value, key) => value?.[key], row);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function notify(message, type = "neutral") {
  const stateEl = document.getElementById("connection-state");
  stateEl.textContent = message;
  stateEl.className = `pill ${type === "bad" ? "bad" : type === "ok" ? "ok" : type === "warn" ? "warn" : "neutral"}`;
}
