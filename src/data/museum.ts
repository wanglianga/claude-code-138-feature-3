import type { Guide, Hall, SecurityLane, Theme } from '@/types'

/** 当日运营日期，所有 mock 时间基于此日期 */
export const TODAY = '2026-10-01'

export const THEMES: Theme[] = [
  {
    id: 't_modern',
    name: '近现代书画导览',
    desc: '从海派绘画到当代水墨，约 90 分钟标准动线',
    durationMin: 90,
    hallIds: ['h1', 'h2', 'h4'],
  },
  {
    id: 't_sculpture',
    name: '雕塑与公共艺术',
    desc: '大型雕塑与沉浸式装置，适合青少年与亲子',
    durationMin: 80,
    hallIds: ['h3', 'h5', 'courtyard'],
  },
  {
    id: 't_master',
    name: '镇馆之宝精华线',
    desc: '热门展品集中路线，约 70 分钟，需提前限流',
    durationMin: 70,
    hallIds: ['h2', 'h4', 'h6'],
  },
  {
    id: 't_west',
    name: '西方艺术简史（外语讲解）',
    desc: '油画与版画专题，配备英语/日语讲解员',
    durationMin: 85,
    hallIds: ['h6', 'h7', 'h1'],
  },
  {
    id: 't_family',
    name: '亲子互动探索线',
    desc: '全部为儿童友好展厅，含互动装置与休息点',
    durationMin: 75,
    hallIds: ['h3', 'h5', 'edu'],
  },
]

export const HALLS: Hall[] = [
  {
    id: 'h1',
    name: '一号厅 · 海派丹青',
    floor: '1F',
    capacity: 60,
    childFriendly: false,
    accessible: true,
    quiet: 3,
    themes: ['t_modern', 't_west'],
    exhibits: [
      { id: 'e11', name: '《风雨归舟图》', hot: true, noPhoto: true, recommendedAge: 10 },
      { id: 'e12', name: '花鸟四条屏', noPhoto: true },
    ],
    closures: [],
    nearTo: ['h2', 'h7'],
  },
  {
    id: 'h2',
    name: '二号厅 · 近现代名家',
    floor: '1F',
    capacity: 45,
    childFriendly: false,
    accessible: true,
    quiet: 3,
    themes: ['t_modern', 't_master'],
    exhibits: [
      { id: 'e21', name: '《长江万里图卷》（摹本）', hot: true, noPhoto: true, recommendedAge: 12 },
      { id: 'e22', name: '行书立轴', recommendedAge: 10 },
    ],
    closures: [],
    nearTo: ['h1', 'h3', 'h4'],
  },
  {
    id: 'h3',
    name: '三号厅 · 雕塑花园',
    floor: '1F',
    capacity: 80,
    childFriendly: true,
    accessible: true,
    quiet: 1,
    themes: ['t_sculpture', 't_family'],
    exhibits: [
      { id: 'e31', name: '《风之翼》大型雕塑', hot: true },
      { id: 'e32', name: '铜兽首系列', recommendedAge: 4 },
    ],
    closures: [],
    nearTo: ['h2', 'h5', 'courtyard'],
  },
  {
    id: 'h4',
    name: '四号厅 · 当代水墨',
    floor: '2F',
    capacity: 35,
    childFriendly: false,
    accessible: false,
    quiet: 3,
    themes: ['t_modern', 't_master'],
    exhibits: [
      { id: 'e41', name: '《新山水》装置', hot: true, noPhoto: true, recommendedAge: 14 },
    ],
    closures: [],
    nearTo: ['h2', 'h6'],
  },
  {
    id: 'h5',
    name: '五号厅 · 沉浸光影',
    floor: '2F',
    capacity: 40,
    childFriendly: true,
    accessible: true,
    quiet: 2,
    themes: ['t_sculpture', 't_family'],
    exhibits: [{ id: 'e51', name: '光影互动墙', hot: true, recommendedAge: 3 }],
    closures: [],
    nearTo: ['h3', 'edu'],
  },
  {
    id: 'h6',
    name: '六号厅 · 油画典藏',
    floor: '2F',
    capacity: 50,
    childFriendly: false,
    accessible: true,
    quiet: 2,
    themes: ['t_master', 't_west'],
    exhibits: [
      { id: 'e61', name: '《午后庭院》', hot: true, noPhoto: true, recommendedAge: 8 },
      { id: 'e62', name: '静物组画' },
    ],
    closures: [],
    nearTo: ['h4', 'h7'],
  },
  {
    id: 'h7',
    name: '七号厅 · 版画工坊',
    floor: '2F',
    capacity: 30,
    childFriendly: true,
    accessible: true,
    quiet: 2,
    themes: ['t_west'],
    exhibits: [{ id: 'e71', name: '铜版技法展示', recommendedAge: 6 }],
    // 当日 11:00-12:00 设备维护
    closures: [{ start: '11:00', end: '12:00', reason: '展柜灯光维护' }],
    nearTo: ['h1', 'h6'],
  },
  {
    id: 'courtyard',
    name: '中庭 · 公共艺术区',
    floor: '1F',
    capacity: 120,
    childFriendly: true,
    accessible: true,
    quiet: 1,
    themes: ['t_sculpture'],
    exhibits: [{ id: 'ec1', name: '《云上》悬挂装置', hot: true, recommendedAge: 3 }],
    closures: [],
    nearTo: ['h3', 'h5'],
  },
  {
    id: 'edu',
    name: '教育体验室',
    floor: '1F',
    capacity: 25,
    childFriendly: true,
    accessible: true,
    quiet: 1,
    themes: ['t_family'],
    exhibits: [{ id: 'ee1', name: '拓印工作台', recommendedAge: 4 }],
    closures: [],
    nearTo: ['h5'],
  },
]

export const GUIDES: Guide[] = [
  {
    id: 'g1',
    name: '林岚',
    langs: ['zh'],
    themes: ['t_modern', 't_master'],
    shifts: [{ start: '09:00', end: '17:00' }],
    phone: '内线 601',
    rating: 4.9,
  },
  {
    id: 'g2',
    name: '周牧',
    langs: ['zh', 'en'],
    themes: ['t_west', 't_master', 't_modern'],
    shifts: [{ start: '09:30', end: '17:30' }],
    phone: '内线 602',
    rating: 4.8,
  },
  {
    id: 'g3',
    name: '苏晓',
    langs: ['zh'],
    themes: ['t_family', 't_sculpture'],
    shifts: [{ start: '08:30', end: '16:30' }],
    phone: '内线 603',
    rating: 5.0,
  },
  {
    id: 'g4',
    name: '陈屿',
    langs: ['zh', 'ja'],
    themes: ['t_west', 't_sculpture'],
    shifts: [{ start: '10:00', end: '18:00' }],
    phone: '内线 604',
    rating: 4.7,
  },
  {
    id: 'g5',
    name: '何田田',
    langs: ['zh'],
    themes: ['t_family', 't_master', 't_modern'],
    shifts: [
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ],
    phone: '内线 605',
    rating: 4.6,
  },
]

export const SECURITY_LANES: SecurityLane[] = [
  { id: 'lane_a', name: 'A 通道 · 团队主通道', perSlot: 45 },
  { id: 'lane_b', name: 'B 通道 · 散客/补检', perSlot: 20 },
  { id: 'lane_acc', name: '无障碍通道', perSlot: 15, accessibleOnly: true },
]

/** 耳麦设备库存 */
export const HEADSET_TOTAL = 120
export const HEADSET_DEPOSIT = 200 // 元/台
export const DAMAGE_FEE = 50
export const LOST_FEE = 200

/** 大团规则 */
export const MAX_GROUP_SIZE = 60
export const LARGE_GROUP_SIZE = 35
export const TOUR_INTERVAL_MIN = 10 // 同展厅相邻团队建议间隔

/** 讲解服务费（元/人），闭展部分退款以此为基数 */
export const TOUR_FEE_PER_PERSON = 20
/** 闭展拒绝替代路线时的部分退款档位（%） */
export const REFUND_RATIOS = [20, 50, 100] as const
