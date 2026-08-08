import assert from 'node:assert/strict'
import test from 'node:test'
import { getPlanCommentsForPath, setPlanCommentsForPath, type PlanCommentsByPath } from '../src/lib/planComments'

const comment = {
  comment: 'Add a rollback step.',
  id: 'comment-1',
  lineEnd: 5,
  lineStart: 3,
  quote: '## Steps',
} as const

test('plan comments are keyed by normalized path and survive tab removal', () => {
  const commentsByPath: PlanCommentsByPath = {}
  const withComment = setPlanCommentsForPath(commentsByPath, '.tidecode\\plans\\plan-001.md', [comment])

  assert.deepEqual(getPlanCommentsForPath(withComment, '.tidecode/plans/plan-001.md'), [comment])
  assert.deepEqual(getPlanCommentsForPath(withComment, '.tidecode\\plans\\plan-001.md'), [comment])

  const afterClosingTab = withComment
  assert.deepEqual(getPlanCommentsForPath(afterClosingTab, '.tidecode/plans/plan-001.md'), [comment])
})

test('clearing plan comments removes only the selected plan path', () => {
  const withComments = setPlanCommentsForPath(
    setPlanCommentsForPath({}, '.tidecode/plans/plan-001.md', [comment]),
    '.tidecode/plans/plan-002.md',
    [{ ...comment, id: 'comment-2' }],
  )

  const withoutFirstPlanComments = setPlanCommentsForPath(withComments, '.tidecode/plans/plan-001.md', [])

  assert.deepEqual(getPlanCommentsForPath(withoutFirstPlanComments, '.tidecode/plans/plan-001.md'), [])
  assert.deepEqual(getPlanCommentsForPath(withoutFirstPlanComments, '.tidecode/plans/plan-002.md'), [
    { ...comment, id: 'comment-2' },
  ])
})
