import { describe, expect, it } from 'vitest'
import {
  canAddWordToDeck,
  canCreateDeck,
  canManageDeck,
  canManageWord,
  canManageGroup,
  canMoveWord,
  canRemoveMember,
  canViewDeck,
  canViewGroup,
  canViewWord,
} from '../src/modules/access/permissions.js'

// Kiểm tra từng luật phân quyền một cách độc lập với DB.
const G = 'group-1'
const ctx = (userId, roles = {}, isSystemAdmin = false) => ({
  userId,
  isSystemAdmin,
  roleByGroupId: new Map(Object.entries(roles)),
})
const owner = ctx('u-owner')
const other = ctx('u-other')
const member = ctx('u-member', { [G]: 'member' })
const admin = ctx('u-admin', { [G]: 'admin' })
const superAdmin = ctx('u-super', {}, true)

const personalDeck = { id: 'd1', user_id: 'u-owner', group_id: null }
const groupDeck = { id: 'd2', user_id: 'u-admin', group_id: G }
const personalWord = { user_id: 'u-owner', deck_id: 'd1' }
const memberWordInGroup = { user_id: 'u-member', deck_id: 'd2' }

describe('Chủ đề cá nhân — chỉ chủ sở hữu', () => {
  it.each([
    ['chủ sở hữu', owner, true],
    ['người khác', other, false],
    ['trưởng 1 nhóm bất kỳ', admin, false],
    ['super admin', superAdmin, false], // khác RLS cũ: super admin không đụng được dữ liệu cá nhân
  ])('%s → xem/quản lý/thêm từ: %s', (_label, c, expected) => {
    expect(canViewDeck(personalDeck, c)).toBe(expected)
    expect(canManageDeck(personalDeck, c)).toBe(expected)
    expect(canAddWordToDeck(personalDeck, c)).toBe(expected)
  })
})

describe('Chủ đề nhóm', () => {
  it.each([
    //  vai trò           xem    thêm từ  quản lý  tạo mới
    ['người ngoài', other, false, false, false, false],
    ['thành viên', member, true, true, false, false],
    ['trưởng nhóm', admin, true, true, true, true],
    ['super admin', superAdmin, true, true, true, true],
  ])('%s', (_label, c, view, add, manage, create) => {
    expect(canViewDeck(groupDeck, c)).toBe(view)
    expect(canAddWordToDeck(groupDeck, c)).toBe(add)
    expect(canManageDeck(groupDeck, c)).toBe(manage)
    expect(canCreateDeck(G, c)).toBe(create)
  })

  it('ai cũng tạo được chủ đề cá nhân và thêm từ chưa phân loại', () => {
    expect(canCreateDeck(null, other)).toBe(true)
    expect(canAddWordToDeck(null, other)).toBe(true)
  })
})

describe('Từ vựng', () => {
  it('từ cá nhân: chỉ người tạo xem/sửa', () => {
    expect(canViewWord(personalWord, personalDeck, owner)).toBe(true)
    expect(canManageWord(personalWord, personalDeck, owner)).toBe(true)
    for (const c of [other, admin, superAdmin]) {
      expect(canViewWord(personalWord, personalDeck, c)).toBe(false)
      expect(canManageWord(personalWord, personalDeck, c)).toBe(false)
    }
  })

  it('từ trong chủ đề nhóm: thành viên xem được nhưng KHÔNG sửa được, kể cả từ chính mình thêm', () => {
    expect(canViewWord(memberWordInGroup, groupDeck, member)).toBe(true)
    expect(canManageWord(memberWordInGroup, groupDeck, member)).toBe(false)
    expect(canManageWord(memberWordInGroup, groupDeck, admin)).toBe(true)
    expect(canManageWord(memberWordInGroup, groupDeck, superAdmin)).toBe(true)
    expect(canViewWord(memberWordInGroup, groupDeck, other)).toBe(false)
  })

  it('người tạo vẫn XEM được từ của mình sau khi rời nhóm', () => {
    const leftGroup = ctx('u-member') // không còn vai trò trong nhóm
    expect(canViewWord(memberWordInGroup, groupDeck, leftGroup)).toBe(true)
    expect(canManageWord(memberWordInGroup, groupDeck, leftGroup)).toBe(false)
  })
})

describe('Chuyển từ sang chủ đề khác', () => {
  const ownerDeck2 = { id: 'd3', user_id: 'u-owner', group_id: null }
  const otherPersonalDeck = { id: 'd4', user_id: 'u-other', group_id: null }
  const memberPersonal = { user_id: 'u-member', deck_id: null }

  it('giữa các chủ đề cá nhân của chính mình / bỏ phân loại: được', () => {
    expect(canMoveWord(personalWord, personalDeck, ownerDeck2, owner)).toBe(true)
    expect(canMoveWord(personalWord, personalDeck, null, owner)).toBe(true)
  })

  it('sang chủ đề cá nhân của người khác: không được', () => {
    expect(canMoveWord(personalWord, personalDeck, otherPersonalDeck, owner)).toBe(false)
  })

  it('thành viên không tự đẩy từ cá nhân vào chủ đề nhóm (sau đó sẽ không sửa được nữa)', () => {
    expect(canMoveWord(memberPersonal, null, groupDeck, member)).toBe(false)
  })

  it('trưởng nhóm đưa từ của mình vào chủ đề nhóm: được', () => {
    const adminWord = { user_id: 'u-admin', deck_id: null }
    expect(canMoveWord(adminWord, null, groupDeck, admin)).toBe(true)
  })

  it('trưởng nhóm KHÔNG kéo từ của thành viên ra khỏi nhóm (bỏ phân loại hay vào chủ đề riêng mình)', () => {
    const adminDeck = { id: 'd5', user_id: 'u-admin', group_id: null }
    expect(canMoveWord(memberWordInGroup, groupDeck, null, admin)).toBe(false)
    expect(canMoveWord(memberWordInGroup, groupDeck, adminDeck, admin)).toBe(false)
  })
})

describe('Nhóm học tập', () => {
  it.each([
    //  vai trò          xem    quản lý  tự rời  mời người khác ra
    ['người ngoài', other, false, false, false, false],
    ['thành viên', member, true, false, true, false],
    ['trưởng nhóm', admin, true, true, true, true],
    ['super admin (không tham gia)', superAdmin, true, true, false, true],
  ])('%s', (_label, c, view, manage, leave, kick) => {
    expect(canViewGroup(G, c)).toBe(view)
    expect(canManageGroup(G, c)).toBe(manage)
    expect(canRemoveMember(G, c.userId, c)).toBe(leave)
    expect(canRemoveMember(G, 'u-someone-else', c)).toBe(kick)
  })
})
