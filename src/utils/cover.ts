import { hashString } from './media'

/**
 * 音频封面。
 *
 * 解析 ID3 / Vorbis 内嵌封面需要引入 ~40KB 的解析库，而且本地文件往往压根没有封面
 * （自己转录的 CD、录音、播客），解析失败率不低。所以这里改用**确定性生成**：
 * 同一个文件名永远得到同一张渐变封面 + 一个音符字形，
 * 视觉上有辨识度、零依赖、零 IO，也顺手解决了「列表里全是灰方块」的问题。
 *
 * 如果将来要读真实封面，入口就在 current.file 上（File 对象可读 arrayBuffer），
 * 到时把这个函数换成"有内嵌则用、否则回退到生成"即可，调用方不用改。
 */
export interface CoverArt {
  /** 主渐变 */
  gradient: string
  /** 叠在上面的高光渐变，制造一点立体感 */
  sheen: string
  /** 用来在封面角落印一个字符，增加区分度 */
  glyph: string
  /** 生成的色相，供其它地方（如背景光晕）复用同一套配色 */
  hue: number
}

/** 从文件名派生一个稳定的封面色板 */
export function coverArtFor(name: string): CoverArt {
  const seed = hashString(name)
  const hue = parseInt(seed, 36) % 360
  // 第二个色相刻意拉开一点距离（±40°），避免渐变成一片死板的同色
  const hue2 = (hue + 40 + (parseInt(seed.slice(-2), 36) % 30)) % 360

  return {
    gradient: `linear-gradient(145deg, hsl(${hue}, 62%, 46%), hsl(${hue2}, 58%, 28%))`,
    sheen: `linear-gradient(160deg, rgba(255,255,255,0.22), transparent 55%)`,
    glyph: (name.trim()[0] || '♪').toUpperCase(),
    hue
  }
}
