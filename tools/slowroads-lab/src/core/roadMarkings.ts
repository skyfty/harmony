import { normalizeFieldHeight, WALL_NODE_SPACING, type RoadStyleProfile } from './roadStyle'
import type { RoadNode } from './roadTrace'

/**
 * 官方道路划线权重（`chunks__SettingsManager.a31845d6.js` class `Mr`，摘录见
 * `reference/official/road-markings.js`）。平台无关移植。
 *
 * 语义（与官方逐项对齐）：
 *  - 虚线（dashed）只要该路型有划线就常驻，不需要逐节点权重；
 *  - 实线（solid / solidLeft / solidRight）按窗口内“树影 × 侧向梯度 × 山脊差”
 *    三项加权后与阈值比较，逐节点打 0/1 权重；
 *  - 实线起点前 `We = markingsMargin / 2` 个节点回填为实线（渐变段），
 *    起点再往前 2 个节点打 `paintMergeLeft`（官方虚线→实线过渡贴图）；
 *  - 右侧实线在上一段结束后第 4 个节点打 `paintMergeRight`。
 *
 * 与官方的等价说明：
 *  - 官方在**细节点**（2m）上累加、在**粗节点**（10m）上判定；lab 追踪步长 8m，
 *    这里统一按 lab 节点判定，窗口长度 = `markingsMargin` 个节点（与官方同口径）；
 *  - `headingDelta`（官方 `da`）按 `10m / 实际步长` 折算，保证转角阈值语义不变；
 *  - 官方 `h`（路面抬升量）在 Hills 的节点字面量里恒为 0，故 `th = 路面官方海拔`，
 *    这里用 `normalizeFieldHeight(y, waterLevel)`（lab ±40m ×4 → 官方 0..300m）。
 */

export interface RoadMarkingWeights {
  solid: boolean
  solidLeft: boolean
  solidRight: boolean
  mergeLeft: boolean
  mergeRight: boolean
}

export interface RoadMarkingOptions {
  style: RoadStyleProfile
  /** lab 追踪步长（米）：把 `da` 折算回官方 10m 节点。 */
  nodeSpacing: number
  /** 路缘树影采样（0..1），官方 `getShadowDensityAt(x, z)`。 */
  shadowAt: (x: number, z: number) => number
  /** 路缘探针横向偏移（米），通常取半宽。 */
  edgeOffset: number
  /** 水面高度（米）：官方海拔门限的零点。 */
  waterLevel: number
}

/** 官方常量：`L7 = 9`（实线接续间隔，节点）、`H/v5 = 5`（低海拔门限，米）、`M2 = 2`（梯度门限）。 */
const SOLID_JOIN_GAP = 9
const LOW_ELEVATION = 5
const GRADIENT_GATE = 2

export function computeRoadMarkings(
  nodes: readonly RoadNode[],
  options: RoadMarkingOptions,
): RoadMarkingWeights[] {
  const weights: RoadMarkingWeights[] = nodes.map(() => ({
    solid: false,
    solidLeft: false,
    solidRight: false,
    mergeLeft: false,
    mergeRight: false,
  }))
  const count = nodes.length
  if (!count) {
    return weights
  }

  const margin = Math.max(1, Math.round(options.style.markingsMargin))
  const taperNodes = Math.max(1, Math.round(margin / 2))
  const daScale = options.nodeSpacing > 0 ? WALL_NODE_SPACING / options.nodeSpacing : 1

  // 官方 `extendFine` 的路缘树影门限（作用在细节点上，这里等价到节点粒度）。
  const edgeShadow = (index: number): { left: number; right: number } => {
    const node = nodes[index]!
    const nx = -Math.sin(node.heading)
    const nz = Math.cos(node.heading)
    let left = options.shadowAt(node.x - nx * options.edgeOffset, node.z - nz * options.edgeOffset)
    let right = options.shadowAt(node.x + nx * options.edgeOffset, node.z + nz * options.edgeOffset)
    const elevation = normalizeFieldHeight(node.y, options.waterLevel)
    if (elevation < LOW_ELEVATION) {
      let leftGate = 1
      let rightGate = 1
      if (node.lateral < 0) {
        leftGate = Math.max(0, 1 - node.lateral / -GRADIENT_GATE)
      } else {
        rightGate = Math.max(0, 1 - node.lateral / GRADIENT_GATE)
      }
      const heightGate = elevation / LOW_ELEVATION
      left *= Math.min(heightGate, leftGate)
      right *= Math.min(heightGate, rightGate)
    } else if (node.lateral < -GRADIENT_GATE) {
      left *= Math.max(0, (node.lateral + GRADIENT_GATE) / GRADIENT_GATE)
    } else if (node.lateral > GRADIENT_GATE) {
      right *= Math.max(0, (node.lateral - GRADIENT_GATE) / GRADIENT_GATE)
    }
    return { left, right }
  }

  let accDa = 0
  let accLateral = 0
  let accTrees = 0
  let prevGradLonDiff = 0
  let prevTurn = 0
  let prevSolidLeftEnd = -1
  let prevSolidRightEnd = -1
  let hasSolidLineLeft = false
  let hasSolidLineRight = false
  let solidLineLeftExtensions = 0
  let solidLineRightExtensions = 0

  let decision = 0
  for (let newest = 0; newest < count; newest += 1) {
    const shadow = edgeShadow(newest)
    const sample = nodes[newest]!
    accDa += sample.headingDelta * daScale
    accLateral += sample.lateral
    accTrees += Math.min(shadow.left, shadow.right)

    // 官方：`if (this.markingsNode.i > t.i - K1 + 1) return;`（判定节点落后窗口末端 K1-1 个节点）。
    while (decision <= newest - (margin - 1)) {
      const node = nodes[decision]!
      let threshold = options.style.solidLineThreshold
      const treeFactor = accTrees / margin
      let lateralFactor = accLateral / margin
      if (Math.abs(lateralFactor) < 0.5 || Math.sign(lateralFactor) !== Math.sign(accDa)) {
        lateralFactor = 0
      } else {
        lateralFactor = Math.abs(lateralFactor)
        lateralFactor = lateralFactor < 0.5 ? 0 : Math.min(1, (lateralFactor - 0.5) * 2)
      }

      // 山脊项：窗口末端与判定节点所在位置的纵向梯度符号翻转时按占比加权。
      const crestNewest = nodes[Math.min(count - 1, newest)]!
      const crestNode = nodes[Math.min(count - 1, decision + (margin - 1))]!
      let gradLonDiff = 0
      if (Math.sign(crestNewest.longitudinal) !== Math.sign(crestNode.longitudinal)) {
        gradLonDiff = crestNewest.longitudinal - crestNode.longitudinal
        let balance = Math.abs(crestNewest.longitudinal)
          / Math.max(1e-6, Math.abs(crestNewest.longitudinal) + Math.abs(crestNode.longitudinal))
        balance = Math.abs(balance - 0.5) * 2
        gradLonDiff *= 1 - balance
      }
      const crest = gradLonDiff * 0.3 + 0.7 * prevGradLonDiff
      prevGradLonDiff = crest
      const crestFactor = crest / options.style.solidLineCrestThreshold
      let weight = Math.max(treeFactor, lateralFactor, crestFactor)
      weight *= 1 + Math.min(1, crestFactor)
      threshold *= 1 - weight * 0.5
      const leftThreshold = threshold * (1 - (accDa / margin) * 4 * weight)
      const rightThreshold = threshold * (1 + (accDa / margin) * 4 * weight)
      const turnMag = Math.abs(accDa / margin) * 0.75 + 0.25 * prevTurn
      prevTurn = turnMag

      // ---- 左侧实线 ---------------------------------------------------------
      if (turnMag > leftThreshold) {
        weights[decision]!.solidLeft = true
        solidLineLeftExtensions = margin - 2
        if (!hasSolidLineLeft) {
          hasSolidLineLeft = true
          let taper = taperNodes
          if (leftThreshold === 0) {
            taper += 2
          }
          if (prevSolidLeftEnd >= 0 && node.index - prevSolidLeftEnd < SOLID_JOIN_GAP + taper) {
            for (let j = prevSolidLeftEnd + 1; j <= decision; j += 1) {
              weights[j]!.solidLeft = true
            }
          } else {
            for (let j = Math.max(0, decision - taper); j < decision; j += 1) {
              weights[j]!.solidLeft = true
            }
            const mergeIndex = decision - taper - 2
            if (mergeIndex >= 0) {
              weights[mergeIndex]!.mergeLeft = true
            }
          }
          prevSolidLeftEnd = decision
        }
      } else if (hasSolidLineLeft) {
        weights[decision]!.solidLeft = true
        prevSolidLeftEnd = decision
        const fade = leftThreshold * 0.6
        if (turnMag < fade) {
          solidLineLeftExtensions -= 1
          if (turnMag < fade * 0.5) {
            solidLineLeftExtensions -= 1
          }
          if (solidLineLeftExtensions <= 0) {
            hasSolidLineLeft = false
          }
        }
      }

      // ---- 右侧实线 ---------------------------------------------------------
      if (turnMag > rightThreshold) {
        weights[decision]!.solidRight = true
        solidLineRightExtensions = margin + 1
        if (!hasSolidLineRight) {
          hasSolidLineRight = true
          if (prevSolidRightEnd >= 0 && node.index - prevSolidRightEnd < SOLID_JOIN_GAP) {
            for (let j = prevSolidRightEnd + 1; j <= decision; j += 1) {
              weights[j]!.solidRight = true
            }
          } else {
            const mergeIndex = prevSolidRightEnd + 4
            if (prevSolidRightEnd >= 0 && mergeIndex < count) {
              weights[mergeIndex]!.mergeRight = true
            }
          }
          prevSolidRightEnd = decision
        }
      } else if (hasSolidLineRight) {
        weights[decision]!.solidRight = true
        prevSolidRightEnd = decision
        const fade = rightThreshold * 0.6
        if (turnMag < fade) {
          solidLineRightExtensions -= 1
          if (solidLineRightExtensions <= 0) {
            hasSolidLineRight = false
          }
        }
      }

      // 官方：滑动窗口时扣掉判定节点的粗节点贡献。
      accDa -= node.headingDelta * daScale
      accLateral -= node.lateral
      const nodeShadow = edgeShadow(decision)
      accTrees -= Math.min(nodeShadow.left, nodeShadow.right)
      decision += 1
    }
  }

  return weights
}
