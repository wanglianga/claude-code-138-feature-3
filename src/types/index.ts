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

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  submitted: '待确认',
  confirmed: '已确认',
  arrived: '已到馆',
  touring: '参观中',
  completed: '已离馆',
  rejected: '已驳回',
  cancelled: '已取消',
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
  | 'closure_notice' // 闭展分流通知已发送联系人
  | 'diversion' // 闭展分流处置（改道/等待恢复）
  | 'theme_switch' // 闭展后更换讲解主题
  | 'refund' // 部分退款
  | 'reschedule' // 改期
  | 'guide_ack' // 讲解员已同步新讲解重点

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

  // —— 闭展分流 ——
  refundTotal?: number // 部分退款累计（元）
  rescheduleOf?: string // 由哪条预约改期而来

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

/* ---------------- 展厅临时闭展分流 ---------------- */

export type ClosureCategory = 'equipment' | 'exhibit' | 'safety' | 'environment' | 'other'

export const CLOSURE_CATEGORY_LABEL: Record<ClosureCategory, string> = {
  equipment: '设备故障',
  exhibit: '展品保护',
  safety: '安全疏导',
  environment: '环境异常',
  other: '其他原因',
}

/** 展厅临时闭展事件（闭展原因进入运营复盘） */
export interface ClosureIncident {
  id: string
  hallId: string
  start: string // HH:mm
  end: string
  reason: string
  category: ClosureCategory
  status: 'active' | 'resolved' // 闭展中 / 已恢复开放
  createdAt: string // ISO
  createdBy: string
  resolvedAt?: string
  /** 运营复盘结论 */
  review?: string
  reviewedBy?: string
  reviewedAt?: string
}

export type DiversionDecision =
  | 'accept_alt' // 接受替代路线
  | 'theme_switch' // 更换讲解主题
  | 'wait_reopen' // 等待恢复开放
  | 'refund' // 拒绝替代路线 → 部分退款
  | 'reschedule' // 拒绝替代路线 → 改期
  | 'complaint' // 拒绝替代路线 → 投诉登记

export const DIVERSION_DECISION_LABEL: Record<DiversionDecision, string> = {
  accept_alt: '接受替代路线',
  theme_switch: '更换讲解主题',
  wait_reopen: '等待恢复开放',
  refund: '部分退款',
  reschedule: '改期',
  complaint: '投诉登记',
}

/** 受影响团队的分流处置记录（一个团队在一个闭展事件中一条） */
export interface DiversionRecord {
  id: string
  incidentId: string
  resId: string
  status: 'pending' | 'notified' | 'done' // 待通知 / 已通知 / 已处置
  notifiedAt?: string
  notifyBy?: string
  decision?: DiversionDecision
  altHallId?: string // 替代展厅
  altThemeId?: string // 更换后的讲解主题
  waitMin?: number // 预计等待分钟
  refundAmount?: number // 部分退款金额
  rescheduleTo?: string // 改期后的到馆时间 ISO
  newResId?: string // 改期生成的新预约
  complaintText?: string
  handledBy?: string
  handledAt?: string
  guideAckAt?: string // 讲解员已同步新讲解重点
}
