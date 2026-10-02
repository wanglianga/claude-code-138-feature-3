/** 领域模型：美术馆团体参观预约 · 设备借还 · 展厅分流 */

export type GroupType = 'school' | 'enterprise' | 'travel'
export type AgeBand = 'children' | 'youth' | 'adult' | 'senior' | 'mixed'
export type Language = 'zh' | 'en' | 'ja'

export type ReservationStatus =
  | 'submitted' // 已提交，待馆方确认
  | 'confirmed' // 馆方已确认
  | 'arrived' // 已到馆，前台核验中
  | 'touring' // 参观进行中
  | 'completed' // 已离馆
  | 'rejected' // 馆方驳回
  | 'cancelled' // 预约方取消
  | 'rescheduled' // 闭展等原因改期待约

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  submitted: '待确认',
  confirmed: '已确认',
  arrived: '已到馆',
  touring: '参观中',
  completed: '已离馆',
  rejected: '已驳回',
  cancelled: '已取消',
  rescheduled: '改期待约',
}

export const GROUP_TYPE_LABEL: Record<GroupType, string> = {
  school: '学校',
  enterprise: '企业',
  travel: '旅行社',
}

export const AGE_LABEL: Record<AgeBand, string> = {
  children: '儿童为主',
  youth: '青少年',
  adult: '成人',
  senior: '银发长者',
  mixed: '年龄混合',
}

export const LANG_LABEL: Record<Language, string> = {
  zh: '中文',
  en: '英语',
  ja: '日语',
}

/** 路线站点 */
export interface RouteStop {
  hallId: string
  plannedEnter: string // HH:mm
  plannedLeave: string
  durationMin: number
  actualEnter?: string
  actualLeave?: string
  /** planned 待参观 / current 正在参观 / done 已完成 / skipped 跳过 / maintenance 临时维护 / congested 拥堵避让 */
  state: 'planned' | 'current' | 'done' | 'skipped' | 'maintenance' | 'congested'
  note?: string
}

export type EventKind =
  | 'submit'
  | 'confirm'
  | 'reject'
  | 'cancel'
  | 'arrive'
  | 'headcount'
  | 'device_handout'
  | 'device_exchange'
  | 'guide_assign'
  | 'guide_swap'
  | 'batch_admit'
  | 'start_tour'
  | 'hall_congestion'
  | 'late'
  | 'child_lost'
  | 'device_broken'
  | 'reroute'
  | 'maintenance'
  | 'wait'
  | 'device_return'
  | 'deposit_settle'
  | 'satisfaction'
  | 'complete'
  | 'complaint'
  // —— 临时闭展分流 ——
  | 'closure_incident' // 登记设备故障闭展
  | 'closure_update' // 闭展进展/结束更新
  | 'closure_notify' // 批量通知联系人
  | 'closure_guide' // 讲解重点同步讲解员
  | 'closure_guide_read' // 讲解员确认已读
  | 'switch_theme' // 更换讲解主题
  | 'partial_refund' // 部分退款
  | 'reschedule' // 改期

export interface TimelineEvent {
  id: string
  at: string // ISO 时间
  kind: EventKind
  title: string
  detail?: string
  amount?: number // 涉及金额（元）
  by: string // 操作人/系统
}

export type DeviceStatus = 'available' | 'lent' | 'returned' | 'damaged' | 'lost'

export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  available: '在库',
  lent: '借出',
  returned: '已归还',
  damaged: '损坏',
  lost: '遗失',
}

export interface DeviceUnit {
  code: string
  status: DeviceStatus
  deposit: number // 单台押金
  resId?: string // 当前借出预约
  lentAt?: string
  returnedAt?: string
  damageFee?: number // 损坏/遗失扣款
  note?: string
}

export interface Reservation {
  id: string
  orgType: GroupType
  orgName: string
  groupSize: number
  ageBand: AgeBand
  language: Language
  accessible: boolean
  themeId: string
  arriveTime: string // ISO，预计到馆
  contactName: string
  contactPhone: string
  busInfo: string
  needHeadsets: boolean
  headsetCount: number
  note: string

  status: ReservationStatus
  createdAt: string

  // —— 馆方确认 ——
  confirmedAt?: string
  confirmNote?: string
  assignedGuideIds: string[]
  batchNo?: string
  securityLane?: string

  // —— 到馆核验 ——
  actualArrive?: string
  verifiedSize?: number

  // —— 路线与时长 ——
  route: RouteStop[]
  durationMin: number

  // —— 设备与押金 ——
  devices: DeviceUnit[]
  depositTotal: number
  depositDeduction: number

  // —— 离馆 ——
  departAt?: string
  satisfaction?: number // 1-5
  complaint?: string
  complaintReply?: string

  // —— 临时闭展分流 ——
  /** 同步给本团讲解员的讲解重点 */
  briefings?: GuideBriefing[]
  /** 部分退款流水 */
  refunds?: RefundRecord[]
  /** 改期后的新预约到馆时间（ISO） */
  rescheduledTo?: string

  timeline: TimelineEvent[]
}

export interface Exhibit {
  id: string
  name: string
  hot?: boolean // 热门展品
  noPhoto?: boolean // 禁止拍照
  recommendedAge?: number // 建议最低年龄
}

export interface HallClosure {
  start: string // HH:mm
  end: string
  reason: string
}

export interface Hall {
  id: string
  name: string
  floor: string
  capacity: number
  childFriendly: boolean
  accessible: boolean // 无障碍可达
  quiet: 1 | 2 | 3 // 安静等级：3 最安静
  themes: string[]
  exhibits: Exhibit[]
  closures: HallClosure[] // 当日临时闭展/维护
  nearTo: string[] // 相邻展厅（用于步行时间/分流）
}

export interface Theme {
  id: string
  name: string
  desc: string
  durationMin: number
  hallIds: string[] // 标准参观顺序
}

export interface GuideShift {
  start: string
  end: string
}

export interface Guide {
  id: string
  name: string
  langs: Language[]
  themes: string[]
  shifts: GuideShift[] // 当日排班
  phone: string
  rating: number // 近30日好评率
}

export interface SecurityLane {
  id: string
  name: string
  perSlot: number // 每 15 分钟可检人数
  accessibleOnly?: boolean
}

/* ============================================================
   临时闭展分流（设备故障）
   ============================================================ */

export type ClosureStatus = 'active' | 'resolved'

/** 联系人通知 */
export interface ClosureNotice {
  id: string
  at: string // ISO
  contactName: string
  contactPhone: string
  channel: 'phone' | 'sms' | 'im' // 电话 / 短信 / 工作群
  by: string
  result: 'pending' | 'delivered' // 待确认 / 已送达
}

/** 讲解员讲解重点同步与已读 */
export interface GuideBriefing {
  id: string
  incidentId: string
  guideId: string
  at: string // ISO 同步时间
  points: string[] // 新的讲解重点
  targetHallName?: string // 替代路线重点展厅
  readAt?: string // 讲解员确认已读时间
}

/** 团队处置单状态 */
export type TeamPlanStatus =
  | 'identified' // 已筛出，待处置
  | 'notified' // 已通知联系人
  | 'rerouted' // 接受替代路线/换主题
  | 'refunded' // 拒绝替代路线 → 部分退款
  | 'rescheduled' // 拒绝替代路线 → 改期
  | 'complaint' // 拒绝替代路线 → 投诉登记

/** 单个团队在一次闭展中的处置 */
export interface ClosureTeamPlan {
  incidentId: string
  /** 原计划受影响站点（hallId） */
  blockedHallId: string
  /** 建议替代展厅（可为空，表示仅顺延） */
  suggestedHallId?: string
  /** 预计等待（分钟） */
  waitMin: number
  /** 是否可更换讲解主题（讲解员语言/能力支持） */
  themeSwitchable: boolean
  /** 可换主题候选 id */
  altThemeIds: string[]
  status: TeamPlanStatus
  notified?: boolean
  notifiedAt?: string
  /** 实际接受的替代展厅（改道落地） */
  appliedHallId?: string
  /** 实际切换到的讲解主题 id */
  switchedThemeId?: string
  /** 团队是否接受替代方案 */
  acceptedAlternative?: boolean
  decidedAt?: string
}

/** 部分退款记录 */
export interface RefundRecord {
  id: string
  incidentId: string
  at: string
  amount: number // 退款金额（元）
  ratio: number // 退款比例（%）
  reason: string
  by: string
}

/** 展厅预警说明（闭展复盘后可挂到展厅） */
export interface HallWarning {
  hallId: string
  text: string
  setAt: string
  by: string
  incidentId: string
}

/** 闭展事件：某展厅设备故障临时关闭 */
export interface ClosureIncident {
  id: string
  hallId: string
  reason: string // 如：投影设备故障
  start: string // HH:mm
  end?: string // 预计恢复 / 实际恢复
  declaredAt: string // ISO
  declaredBy: string
  status: ClosureStatus
  resolvedAt?: string
  resolvedNote?: string
  /** 受影响团队处置（按预约 id 索引） */
  plans: Record<string, ClosureTeamPlan>
  /** 批量通知记录（跨团队汇总） */
  notices: ClosureNotice[]
  /** 运营复盘备注 */
  reviewNote?: string
}
