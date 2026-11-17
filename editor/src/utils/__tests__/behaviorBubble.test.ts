import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBehaviorBubble } from '../../../../scenery/composables/useBehaviorBubble'

function createBubble() {
  return useBehaviorBubble({
    resolveBehaviorToken: vi.fn(),
    loadTextAssetContent: vi.fn(async () => null),
    canPresent: () => true,
  })
}

describe('transient behavior bubbles', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a success bubble immediately and hides it after its duration', () => {
    const bubble = createBubble()

    bubble.presentTransient({
      message: '青龙山大门打卡成功',
      eyebrow: '完成',
      title: '青龙山大门',
      status: '打卡成功',
      durationSeconds: 2.5,
      variant: 'success',
      animation: 'float',
    })

    expect(bubble.state).toMatchObject({
      visible: true,
      transient: true,
      message: '青龙山大门打卡成功',
      eyebrow: '完成',
      title: '青龙山大门',
      status: '打卡成功',
      variant: 'success',
      animation: 'float',
      anchorMode: 'screenFixed',
      offsetY: 0,
    })
    vi.advanceTimersByTime(2499)
    expect(bubble.state.visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(bubble.state.visible).toBe(false)
    expect(bubble.state.transient).toBe(false)
    expect(bubble.state.message).toBe('')
    expect(bubble.state.eyebrow).toBe('')
    expect(bubble.state.title).toBe('')
    expect(bubble.state.status).toBe('')
  })

  it('lets the latest prompt replace the previous message and timer', () => {
    const bubble = createBubble()

    bubble.presentTransient({
      message: '青龙山大门打卡成功',
      eyebrow: '完成',
      title: '青龙山大门',
      status: '打卡成功',
      durationSeconds: 2.5,
    })
    vi.advanceTimersByTime(1000)
    bubble.presentTransient({
      message: '延古寺打卡成功',
      eyebrow: '完成',
      title: '延古寺',
      status: '打卡成功',
      durationSeconds: 2.5,
    })
    vi.advanceTimersByTime(2000)

    expect(bubble.state.visible).toBe(true)
    expect(bubble.state.message).toBe('延古寺打卡成功')
    expect(bubble.state.title).toBe('延古寺')
    vi.advanceTimersByTime(500)
    expect(bubble.state.visible).toBe(false)
  })

  it('does not show an empty or zero-duration prompt', () => {
    const bubble = createBubble()

    bubble.presentTransient({ message: '   ', durationSeconds: 2.5 })
    bubble.presentTransient({ message: '打卡成功', durationSeconds: 0 })

    expect(bubble.state.visible).toBe(false)
  })
})
