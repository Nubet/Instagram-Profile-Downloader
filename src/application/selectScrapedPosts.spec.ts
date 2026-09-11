import { describe, expect, it } from 'vitest'
import { selectScrapedPosts } from '~/features/profileDownload/application/selectScrapedPosts'
import type { ScrapedPost } from '~/features/profileDownload/domain/profileDownload'

const posts: ScrapedPost[] = [
  {
    id: 'post-1',
    media: [{ url: 'https://cdn.example.com/post-1.jpg', type: 'image' }],
    caption: 'Caption 1',
    profileName: 'nubet',
  },
  {
    id: 'post-2',
    media: [{ url: 'https://cdn.example.com/post-2.jpg', type: 'image' }],
    caption: 'Caption 2',
    profileName: 'nubet',
  },
  {
    id: 'post-3',
    media: [{ url: 'https://cdn.example.com/post-3.jpg', type: 'image' }],
    caption: 'Caption 3',
    profileName: 'nubet',
  },
]

describe('selectScrapedPosts', () => {
  it('returns all posts for all selection', () => {
    expect(selectScrapedPosts(posts, { type: 'all' })).toEqual(posts)
  })

  it('returns a 1-based inclusive range of posts', () => {
    expect(selectScrapedPosts(posts, { type: 'range', startIndex: 2, endIndex: 3 })).toEqual(posts.slice(1, 3))
  })

  it('returns empty list for an inverted range', () => {
    expect(selectScrapedPosts(posts, { type: 'range', startIndex: 3, endIndex: 2 })).toEqual([])
  })

  it('returns only manually selected posts while preserving order', () => {
    expect(selectScrapedPosts(posts, { type: 'ids', postIds: ['post-3', 'post-1'] })).toEqual([posts[0], posts[2]])
  })
})
