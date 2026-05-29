export interface MaxRectsInputRect<TId extends string | number = string | number> {
  id: TId;
  width: number;
  height: number;
}

export interface MaxRectsPlacement<TId extends string | number = string | number> {
  id: TId;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MaxRectsPageStats {
  page: number;
  width: number;
  height: number;
  border: number;
  rects: number;
  usedArea: number;
  usableArea: number;
  occupancy: number;
}

export interface MaxRectsPackingStats {
  pages: number;
  rects: number;
  usedArea: number;
  usableArea: number;
  occupancy: number;
  pageStats: MaxRectsPageStats[];
}

export interface MaxRectsPackingResult<TId extends string | number = string | number> {
  placements: MaxRectsPlacement<TId>[];
  stats: MaxRectsPackingStats;
}

export interface MaxRectsPackerOptions {
  width: number;
  height: number;
  padding?: number;
  border?: number;
  spacing?: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Candidate {
  scoreShortSide: number;
  scoreLongSide: number;
  x: number;
  y: number;
}

class MaxRectsPage<TId extends string | number> {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly border: number;
  private freeRects: Rect[];
  private usedRects: Rect[] = [];
  constructor(index: number, width: number, height: number, border: number) {
    this.index = index;
    this.width = width;
    this.height = height;
    this.border = border;

    const usableWidth = Math.max(0, width - border * 2);
    const usableHeight = Math.max(0, height - border * 2);
    this.freeRects = usableWidth > 0 && usableHeight > 0
      ? [{ x: border, y: border, width: usableWidth, height: usableHeight }]
      : [];
  }

  insert(id: TId, width: number, height: number): MaxRectsPlacement<TId> | null {
    const candidate = this.findBestCandidate(width, height);
    if (!candidate) return null;

    const used: Rect = { x: candidate.x, y: candidate.y, width, height };
    this.splitFreeRects(used);
    this.pruneFreeRects();

    this.usedRects.push(used);
    const placement = { id, page: this.index, ...used };
    return placement;
  }

  stats(): MaxRectsPageStats {
    const usedArea = this.usedRects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    const usableArea = Math.max(0, this.width - this.border * 2) * Math.max(0, this.height - this.border * 2);

    return {
      page: this.index,
      width: this.width,
      height: this.height,
      border: this.border,
      rects: this.usedRects.length,
      usedArea,
      usableArea,
      occupancy: usableArea > 0 ? usedArea / usableArea : 0,
    };
  }

  private findBestCandidate(width: number, height: number): Candidate | null {
    let best: Candidate | null = null;

    for (let i = 0; i < this.freeRects.length; i++) {
      const free = this.freeRects[i];
      if (width > free.width || height > free.height) continue;

      const leftoverX = free.width - width;
      const leftoverY = free.height - height;
      const candidate: Candidate = {
        scoreShortSide: Math.min(leftoverX, leftoverY),
        scoreLongSide: Math.max(leftoverX, leftoverY),
        x: free.x,
        y: free.y,
      };

      if (
        !best ||
        candidate.scoreShortSide < best.scoreShortSide ||
        (candidate.scoreShortSide === best.scoreShortSide && candidate.scoreLongSide < best.scoreLongSide) ||
        (candidate.scoreShortSide === best.scoreShortSide && candidate.scoreLongSide === best.scoreLongSide && candidate.y < best.y) ||
        (candidate.scoreShortSide === best.scoreShortSide && candidate.scoreLongSide === best.scoreLongSide && candidate.y === best.y && candidate.x < best.x)
      ) {
        best = candidate;
      }
    }

    return best;
  }

  private splitFreeRects(used: Rect) {
    const next: Rect[] = [];

    for (const free of this.freeRects) {
      if (!intersects(free, used)) {
        next.push(free);
        continue;
      }

      if (used.x > free.x) {
        next.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
      }

      const usedRight = used.x + used.width;
      const freeRight = free.x + free.width;
      if (usedRight < freeRight) {
        next.push({ x: usedRight, y: free.y, width: freeRight - usedRight, height: free.height });
      }

      if (used.y > free.y) {
        next.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
      }

      const usedBottom = used.y + used.height;
      const freeBottom = free.y + free.height;
      if (usedBottom < freeBottom) {
        next.push({ x: free.x, y: usedBottom, width: free.width, height: freeBottom - usedBottom });
      }
    }

    this.freeRects = next.filter(rect => rect.width > 0 && rect.height > 0);
  }

  private pruneFreeRects() {
    for (let i = 0; i < this.freeRects.length; i++) {
      for (let j = i + 1; j < this.freeRects.length; j++) {
        const a = this.freeRects[i];
        const b = this.freeRects[j];

        if (contains(a, b)) {
          this.freeRects.splice(j, 1);
          j--;
        } else if (contains(b, a)) {
          this.freeRects.splice(i, 1);
          i--;
          break;
        }
      }
    }
  }
}

export function packMaxRects<TId extends string | number>(
  rects: MaxRectsInputRect<TId>[],
  options: MaxRectsPackerOptions,
): MaxRectsPackingResult<TId> {
  const pageWidth = Math.max(0, Math.floor(options.width));
  const pageHeight = Math.max(0, Math.floor(options.height));
  const padding = Math.max(0, Math.floor(options.padding ?? 0));
  const border = Math.max(0, Math.floor(options.border ?? 0));
  const spacing = Math.max(0, Math.floor(options.spacing ?? 0));
  const pages: MaxRectsPage<TId>[] = [];
  const placements: MaxRectsPlacement<TId>[] = [];
  const sortable = rects.map((rect, order) => {
    const packedWidth = Math.ceil(rect.width) + padding * 2 + spacing;
    const packedHeight = Math.ceil(rect.height) + padding * 2 + spacing;
    return { ...rect, order, packedWidth, packedHeight };
  });

  const usableWidth = pageWidth - border * 2;
  const usableHeight = pageHeight - border * 2;
  for (const rect of sortable) {
    if (rect.packedWidth > usableWidth || rect.packedHeight > usableHeight) {
      throw new Error(`Rectangle ${String(rect.id)} (${rect.width}×${rect.height}) exceeds atlas usable area ${usableWidth}×${usableHeight}`);
    }
  }

  sortable.sort((a, b) => {
    const maxSideDiff = Math.max(b.packedWidth, b.packedHeight) - Math.max(a.packedWidth, a.packedHeight);
    if (maxSideDiff !== 0) return maxSideDiff;
    const areaDiff = b.packedWidth * b.packedHeight - a.packedWidth * a.packedHeight;
    if (areaDiff !== 0) return areaDiff;
    return a.order - b.order;
  });

  for (const rect of sortable) {
    let placement: MaxRectsPlacement<TId> | null = null;

    for (const page of pages) {
      placement = page.insert(rect.id, rect.packedWidth, rect.packedHeight);
      if (placement) break;
    }

    if (!placement) {
      const page = new MaxRectsPage<TId>(pages.length, pageWidth, pageHeight, border);
      pages.push(page);
      placement = page.insert(rect.id, rect.packedWidth, rect.packedHeight);
    }

    if (!placement) {
      throw new Error(`Rectangle ${String(rect.id)} could not be packed`);
    }

    placements.push({
      id: rect.id,
      page: placement.page,
      x: placement.x + padding,
      y: placement.y + padding,
      width: rect.width,
      height: rect.height,
    });
  }

  const pageStats = pages.map(page => page.stats());
  const usedArea = pageStats.reduce((sum, page) => sum + page.usedArea, 0);
  const usableArea = pageStats.reduce((sum, page) => sum + page.usableArea, 0);

  const orderById = new Map(rects.map((rect, order) => [rect.id, order]));

  return {
    placements: placements.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0)),
    stats: {
      pages: pages.length,
      rects: rects.length,
      usedArea,
      usableArea,
      occupancy: usableArea > 0 ? usedArea / usableArea : 0,
      pageStats,
    },
  };
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(a: Rect, b: Rect) {
  return b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
}
