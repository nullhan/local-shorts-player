import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 鼠标静止一段时间后自动隐藏控件。
 *
 * 只在「鼠标真的移动」时唤醒控件 —— 刻意不监听 mousedown / keydown / wheel：
 * 点击画面暂停、按 ←→ 调进度、滚轮切视频时都应该保持干净的画面，
 * 否则顶/底两条黑色渐变会反复闪现（用户反馈的「黑色遮罩层」）。
 * 需要控件时，轻轻晃一下鼠标即可。
 */
export function useIdle(timeout = 2600) {
  const idle = ref(false)
  let timer: number | undefined

  const reset = () => {
    idle.value = false
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      idle.value = true
    }, timeout)
  }

  onMounted(() => {
    window.addEventListener('mousemove', reset, { passive: true })
    reset()
  })

  onBeforeUnmount(() => {
    if (timer) window.clearTimeout(timer)
    window.removeEventListener('mousemove', reset)
  })

  return { idle, wake: reset }
}
