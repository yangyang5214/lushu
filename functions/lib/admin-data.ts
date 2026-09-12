/// <reference types="@cloudflare/workers-types" />
//
// 管理后台数据查询与删除。

import { isUserActivated, type UserRow } from './auth'

type Env = { DB: D1Database }

function parseDoc(docText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(docText) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* 脏数据 */
  }
  return null
}

function asVisibility(raw: unknown): 'public' | 'private' {
  return raw === 'private' ? 'private' : 'public'
}

function pageParams(request: Request): { limit: number; offset: number } {
  const url = new URL(request.url)
  const rawLimit = Number(url.searchParams.get('limit'))
  const rawOffset = Number(url.searchParams.get('offset'))
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 100) : 50
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.floor(rawOffset), 0) : 0
  return { limit, offset }
}

export async function adminStats(env: Env): Promise<{
  users: number
  books: number
  publicBooks: number
  privateBooks: number
}> {
  const users = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0
  const books = (await env.DB.prepare('SELECT COUNT(*) AS n FROM books').first<{ n: number }>())?.n ?? 0
  const publicBooks =
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM books
          WHERE COALESCE(json_extract(doc, '$.visibility'), 'public') = 'public'`,
      ).first<{ n: number }>()
    )?.n ?? 0
  return { users, books, publicBooks, privateBooks: books - publicBooks }
}

export type AdminUserRow = {
  id: string
  hashId: string
  email: string
  displayName: string
  createdAt: number
  activated: boolean
  bookCount: number
}

export async function adminListUsers(
  env: Env,
  request: Request,
): Promise<{ users: AdminUserRow[]; total: number }> {
  const { limit, offset } = pageParams(request)
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase()
  const like = q ? `%${q.replace(/[%_]/g, '')}%` : null

  let total = 0
  let rows: Array<UserRow & { book_count: number }> = []

  if (like) {
    total =
      (
        await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM users
            WHERE LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?`,
        )
          .bind(like, like)
          .first<{ n: number }>()
      )?.n ?? 0
    const res = await env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.pass_hash, u.hash_id, u.created_at, u.activated_at,
              (SELECT COUNT(*) FROM books b WHERE b.owner_key = u.id) AS book_count
         FROM users u
        WHERE LOWER(u.username) LIKE ? OR LOWER(u.display_name) LIKE ?
        ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(like, like, limit, offset)
      .all<UserRow & { book_count: number }>()
    rows = res.results ?? []
  } else {
    total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0
    const res = await env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.pass_hash, u.hash_id, u.created_at, u.activated_at,
              (SELECT COUNT(*) FROM books b WHERE b.owner_key = u.id) AS book_count
         FROM users u
        ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<UserRow & { book_count: number }>()
    rows = res.results ?? []
  }

  const users: AdminUserRow[] = rows.map((row) => ({
    id: row.id,
    hashId: row.hash_id ?? '',
    email: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    activated: isUserActivated(row),
    bookCount: row.book_count ?? 0,
  }))
  return { users, total }
}

export async function adminGetUser(
  env: Env,
  userId: string,
): Promise<{
  user: AdminUserRow
  books: Array<{
    id: string
    title: string
    startDate: string
    places: number
    visibility: 'public' | 'private'
    updatedAt: number
  }>
} | null> {
  const row = await env.DB.prepare(
    `SELECT id, username, display_name, pass_hash, hash_id, created_at, activated_at
       FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<UserRow>()
  if (!row) return null

  const bookRows = await env.DB.prepare(
    'SELECT id, doc, updated_at FROM books WHERE owner_key = ? ORDER BY updated_at DESC LIMIT 200',
  )
    .bind(userId)
    .all<{ id: string; doc: string; updated_at: number }>()

  const books = (bookRows.results ?? []).map((b) => {
    const doc = parseDoc(b.doc) ?? {}
    return {
      id: b.id,
      title: typeof doc.title === 'string' ? doc.title : '',
      startDate: typeof doc.startDate === 'string' ? doc.startDate : '',
      places: Array.isArray(doc.places) ? doc.places.length : 0,
      visibility: asVisibility(doc.visibility),
      updatedAt: b.updated_at,
    }
  })

  return {
    user: {
      id: row.id,
      hashId: row.hash_id ?? '',
      email: row.username,
      displayName: row.display_name,
      createdAt: row.created_at,
      activated: isUserActivated(row),
      bookCount: books.length,
    },
    books,
  }
}

export type AdminBookRow = {
  id: string
  title: string
  startDate: string
  places: number
  visibility: 'public' | 'private'
  updatedAt: number
  createdAt: number
  ownerId: string | null
  ownerEmail: string | null
  ownerHashId: string | null
}

export async function adminListBooks(
  env: Env,
  request: Request,
): Promise<{ books: AdminBookRow[]; total: number }> {
  const { limit, offset } = pageParams(request)
  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const vis = url.searchParams.get('visibility')
  const like = q ? `%${q.replace(/[%_]/g, '')}%` : null

  const visFilter =
    vis === 'public'
      ? "COALESCE(json_extract(b.doc, '$.visibility'), 'public') = 'public'"
      : vis === 'private'
        ? "json_extract(b.doc, '$.visibility') = 'private'"
        : '1=1'

  let total = 0
  type Row = {
    id: string
    doc: string
    created_at: number
    updated_at: number
    owner_key: string | null
    owner_email: string | null
    owner_hash_id: string | null
  }
  let rows: Row[] = []

  if (like) {
    total =
      (
        await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM books b
            WHERE ${visFilter} AND LOWER(json_extract(b.doc, '$.title')) LIKE ?`,
        )
          .bind(like)
          .first<{ n: number }>()
      )?.n ?? 0
    const res = await env.DB.prepare(
      `SELECT b.id, b.doc, b.created_at, b.updated_at, b.owner_key,
              u.username AS owner_email, u.hash_id AS owner_hash_id
         FROM books b LEFT JOIN users u ON u.id = b.owner_key
        WHERE ${visFilter} AND LOWER(json_extract(b.doc, '$.title')) LIKE ?
        ORDER BY b.updated_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(like, limit, offset)
      .all<Row>()
    rows = res.results ?? []
  } else {
    total =
      (
        await env.DB.prepare(`SELECT COUNT(*) AS n FROM books b WHERE ${visFilter}`).first<{
          n: number
        }>()
      )?.n ?? 0
    const res = await env.DB.prepare(
      `SELECT b.id, b.doc, b.created_at, b.updated_at, b.owner_key,
              u.username AS owner_email, u.hash_id AS owner_hash_id
         FROM books b LEFT JOIN users u ON u.id = b.owner_key
        WHERE ${visFilter}
        ORDER BY b.updated_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<Row>()
    rows = res.results ?? []
  }

  const books: AdminBookRow[] = rows.map((row) => {
    const doc = parseDoc(row.doc) ?? {}
    return {
      id: row.id,
      title: typeof doc.title === 'string' ? doc.title : '',
      startDate: typeof doc.startDate === 'string' ? doc.startDate : '',
      places: Array.isArray(doc.places) ? doc.places.length : 0,
      visibility: asVisibility(doc.visibility),
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      ownerId: row.owner_key,
      ownerEmail: row.owner_email,
      ownerHashId: row.owner_hash_id,
    }
  })
  return { books, total }
}

export async function adminGetBook(
  env: Env,
  bookId: string,
): Promise<{
  id: string
  doc: Record<string, unknown>
  updatedAt: number
  createdAt: number
  ownerId: string | null
  ownerEmail: string | null
  ownerHashId: string | null
} | null> {
  const row = await env.DB.prepare(
    `SELECT b.id, b.doc, b.created_at, b.updated_at, b.owner_key,
            u.username AS owner_email, u.hash_id AS owner_hash_id
       FROM books b LEFT JOIN users u ON u.id = b.owner_key
      WHERE b.id = ?`,
  )
    .bind(bookId)
    .first<{
      id: string
      doc: string
      created_at: number
      updated_at: number
      owner_key: string | null
      owner_email: string | null
      owner_hash_id: string | null
    }>()
  if (!row) return null
  const doc = parseDoc(row.doc) ?? {}
  return {
    id: row.id,
    doc: { ...doc, visibility: asVisibility(doc.visibility) },
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    ownerId: row.owner_key,
    ownerEmail: row.owner_email,
    ownerHashId: row.owner_hash_id,
  }
}

/**
 * 删除一本路书（管理后台）。硬删，同时回收一个容量名额（stats.books）。
 * 返回 false 表示这本书本来就不存在。
 */
export async function adminDeleteBook(env: Env, bookId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM books WHERE id = ?')
    .bind(bookId)
    .first<{ id: string }>()
  if (!row) return false
  await env.DB.batch([
    env.DB.prepare('DELETE FROM books WHERE id = ?').bind(bookId),
    env.DB.prepare("UPDATE stats SET n = MAX(n - 1, 0) WHERE k = 'books'"),
  ])
  return true
}

/**
 * 删除一个账号：连同其名下的路书、会话、待激活记录一起清掉（硬删，不可恢复）。
 * 返回 null 表示账号不存在；否则返回被连带删除的路书数量。
 */
export async function adminDeleteUser(
  env: Env,
  userId: string,
): Promise<{ books: number } | null> {
  const row = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; username: string }>()
  if (!row) return null

  const books =
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM books WHERE owner_key = ?')
        .bind(userId)
        .first<{ n: number }>()
    )?.n ?? 0

  await env.DB.batch([
    env.DB.prepare('DELETE FROM books WHERE owner_key = ?').bind(userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM email_activations WHERE email = ?').bind(row.username),
    env.DB.prepare("UPDATE stats SET n = MAX(n - ?, 0) WHERE k = 'books'").bind(books),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ])
  return { books }
}
