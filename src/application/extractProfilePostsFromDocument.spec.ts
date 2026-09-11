import { describe, expect, it } from 'vitest'
import { extractProfilePostsFromDocument } from '~/features/profileDownload/infrastructure/extractProfilePostsFromDocument'

describe('extractProfilePostsFromDocument', () => {
  it('extracts unique posts from profile anchors', () => {
    document.body.innerHTML = `
      <main>
        <a href="/p/post-1/">
          <img src="https://cdn.example.com/post-1.jpg" alt="First caption" />
        </a>
        <a href="/p/post-2/">
          <img src="https://cdn.example.com/post-2.jpg" alt="Second caption" />
        </a>
        <a href="/p/post-1/">
          <img src="https://cdn.example.com/post-1-duplicate.jpg" alt="Duplicate" />
        </a>
      </main>
    `

    expect(extractProfilePostsFromDocument(document, 'nubet')).toEqual({
      diagnostics: {
        anchorCount: 2,
        postLinkCount: 2,
        duplicatePostCount: 0,
        missingMediaCount: 0,
        missingSourceCount: 0,
        addedPostCount: 2,
        selector: 'main',
        sampleAnchorPaths: ['/p/post-1', '/p/post-2'],
        samplePostPaths: ['/p/post-1', '/p/post-2'],
      },
      seenPostIds: new Set(['post-1', 'post-2']),
      posts: [
        {
          id: 'post-1',
          media: [{ url: 'https://cdn.example.com/post-1.jpg', type: 'image' }],
          caption: '',
          profileName: 'nubet',
        },
        {
          id: 'post-2',
          media: [{ url: 'https://cdn.example.com/post-2.jpg', type: 'image' }],
          caption: '',
          profileName: 'nubet',
        },
      ],
    })
  })

  it('ignores already seen posts and non-post links', () => {
    document.body.innerHTML = `
      <main>
        <a href="/explore/">
          <img src="https://cdn.example.com/explore.jpg" alt="Ignore" />
        </a>
        <a href="/reel/post-3/">
          <img src="https://cdn.example.com/post-3.jpg" alt="Third caption" />
        </a>
      </main>
    `

    expect(extractProfilePostsFromDocument(document, 'nubet', ['post-3'])).toEqual({
      diagnostics: {
        anchorCount: 1,
        postLinkCount: 1,
        duplicatePostCount: 1,
        missingMediaCount: 0,
        missingSourceCount: 0,
        addedPostCount: 0,
        selector: 'main',
        sampleAnchorPaths: ['/reel/post-3'],
        samplePostPaths: ['/reel/post-3'],
      },
      seenPostIds: new Set(['post-3']),
      posts: [],
    })
  })

  it('falls back to document-wide post anchors and srcset media', () => {
    document.body.innerHTML = `
      <div>
        <a href="/p/post-4/">
          <img srcset="https://cdn.example.com/post-4.jpg 640w, https://cdn.example.com/post-4-large.jpg 1280w" />
        </a>
      </div>
    `

    expect(extractProfilePostsFromDocument(document, 'nubet')).toEqual({
      diagnostics: {
        anchorCount: 1,
        postLinkCount: 1,
        duplicatePostCount: 0,
        missingMediaCount: 0,
        missingSourceCount: 0,
        addedPostCount: 1,
        selector: 'document',
        sampleAnchorPaths: ['/p/post-4'],
        samplePostPaths: ['/p/post-4'],
      },
      seenPostIds: new Set(['post-4']),
      posts: [
        {
          id: 'post-4',
          media: [{ url: 'https://cdn.example.com/post-4.jpg', type: 'image' }],
          caption: '',
          profileName: 'nubet',
        },
      ],
    })
  })

  it('extracts post ids from nested path segments', () => {
    document.body.innerHTML = `
      <main>
        <a href="/nubet/p/post-5/">
          <img src="https://cdn.example.com/post-5.jpg" alt="Nested path caption" />
        </a>
      </main>
    `

    expect(extractProfilePostsFromDocument(document, 'nubet').posts).toEqual([
      {
        id: 'post-5',
        media: [{ url: 'https://cdn.example.com/post-5.jpg', type: 'image' }],
        caption: '',
        profileName: 'nubet',
      },
    ])
  })
})
