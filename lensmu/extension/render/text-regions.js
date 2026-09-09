// OCR regions and reading order. Pure: shared by preparation and display.
import { detectCJK, normalizeTranslationText } from '../shared/text-layout.js';

export const OCR_BLOCK_TUNING = {
  paragraphMergeGapMultiplier: 1.35,
  paragraphMergeGapPx: 18,
  sameLineOverlapRatio: 0.55,
  sameLineGapMultiplier: 1.8,
  sameLineGapPx: 24,
  columnOverlapRatio: 0.2,
  edgeAlignmentToleranceMultiplier: 0.9,
  edgeAlignmentTolerancePx: 24,
  centerAlignmentToleranceRatio: 0.18,
  centerAlignmentTolerancePx: 24
};

function rangeOverlap(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function rangeOverlapRatio(startA, endA, startB, endB) {
  const minSpan = Math.max(1, Math.min(endA - startA, endB - startB));
  return rangeOverlap(startA, endA, startB, endB) / minSpan;
}

function rangeGap(startA, endA, startB, endB) {
  if (endA < startB) return startB - endA;
  if (endB < startA) return startA - endB;
  return 0;
}

function getBoxRight(box) {
  return box.x + box.width;
}

function getBoxBottom(box) {
  return box.y + box.height;
}

function unionBoxes(boxes) {
  if (!boxes.length) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => getBoxRight(box)));
  const maxY = Math.max(...boxes.map((box) => getBoxBottom(box)));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function shouldInsertSpace(previousText, nextText) {
  if (!previousText || !nextText) return false;
  if (detectCJK(previousText) || detectCJK(nextText)) return false;
  if (/[-/]$/.test(previousText)) return false;
  if (/^[,.;:!?%)}\]]/.test(nextText)) return false;
  return true;
}

function getReadingOrderComparator(orientation) {
  if (orientation === 'vertical') {
    return (a, b) => {
      const xDiff = b.bbox.x - a.bbox.x;
      if (Math.abs(xDiff) > 4) return xDiff;
      return a.bbox.y - b.bbox.y;
    };
  }

  return (a, b) => {
    const yDiff = a.bbox.y - b.bbox.y;
    if (Math.abs(yDiff) > 4) return yDiff;
    return a.bbox.x - b.bbox.x;
  };
}

function clusterMembersByLine(members, orientation) {
  if (!members.length) return [];

  const comparator = getReadingOrderComparator(orientation);
  const sorted = [...members].sort(comparator);
  const groups = [];

  for (const member of sorted) {
    const box = member.bbox;
    let placed = false;

    for (const group of groups) {
      const groupBox = unionBoxes(group.map((item) => item.bbox));
      const sameLine =
        orientation === 'vertical'
          ? rangeOverlapRatio(groupBox.x, getBoxRight(groupBox), box.x, getBoxRight(box)) >= 0.45
          : rangeOverlapRatio(groupBox.y, getBoxBottom(groupBox), box.y, getBoxBottom(box)) >= 0.45;

      if (sameLine) {
        group.push(member);
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push([member]);
    }
  }

  return groups.map((group) => [...group].sort(comparator));
}

function detectBlockAlignment(members, orientation, bbox) {
  if (orientation === 'vertical') {
    return 'center';
  }

  const lineGroups = clusterMembersByLine(members, orientation).map((group) =>
    unionBoxes(group.map((item) => item.bbox))
  );

  if (lineGroups.length <= 1) {
    const wordCount = members[0]?.text?.trim().split(/\s+/).filter(Boolean).length || 0;
    if (
      wordCount > 0 &&
      wordCount <= 10 &&
      bbox.width > bbox.height * 2.4
    ) {
      return 'center';
    }
    return 'left';
  }

  const leftValues = lineGroups.map((lineBox) => lineBox.x);
  const rightValues = lineGroups.map((lineBox) => getBoxRight(lineBox));
  const centerValues = lineGroups.map((lineBox) => lineBox.x + lineBox.width / 2);
  const tolerance = Math.max(12, bbox.width * 0.12);

  const leftSpread = Math.max(...leftValues) - Math.min(...leftValues);
  const rightSpread = Math.max(...rightValues) - Math.min(...rightValues);
  const centerSpread = Math.max(...centerValues) - Math.min(...centerValues);

  if (centerSpread <= tolerance && leftSpread > tolerance * 0.8 && rightSpread > tolerance * 0.8) {
    return 'center';
  }

  if (leftSpread <= tolerance) {
    return 'left';
  }

  if (rightSpread <= tolerance) {
    return 'right';
  }

  return 'left';
}

function getAxisMetrics(box, orientation) {
  if (orientation === 'vertical') {
    return {
      flowStart: box.x,
      flowEnd: getBoxRight(box),
      flowSize: box.width,
      lineStart: box.y,
      lineEnd: getBoxBottom(box),
      lineSize: box.height
    };
  }

  return {
    flowStart: box.y,
    flowEnd: getBoxBottom(box),
    flowSize: box.height,
    lineStart: box.x,
    lineEnd: getBoxRight(box),
    lineSize: box.width
  };
}

function canMergeBlocks(a, b) {
  const aIsVertical = a.orientation === 'vertical';
  const bIsVertical = b.orientation === 'vertical';

  if (aIsVertical !== bIsVertical) {
    return false;
  }

  const orientation = aIsVertical ? 'vertical' : 'horizontal';
  const aAxis = getAxisMetrics(a.bbox, orientation);
  const bAxis = getAxisMetrics(b.bbox, orientation);
  const lineOverlapRatio = rangeOverlapRatio(
    aAxis.lineStart,
    aAxis.lineEnd,
    bAxis.lineStart,
    bAxis.lineEnd
  );
  const flowOverlapRatio = rangeOverlapRatio(
    aAxis.flowStart,
    aAxis.flowEnd,
    bAxis.flowStart,
    bAxis.flowEnd
  );
  const lineGap = rangeGap(aAxis.lineStart, aAxis.lineEnd, bAxis.lineStart, bAxis.lineEnd);
  const flowGap = rangeGap(aAxis.flowStart, aAxis.flowEnd, bAxis.flowStart, bAxis.flowEnd);
  const averageFlowSize = (aAxis.flowSize + bAxis.flowSize) / 2;
  const edgeTolerance = Math.max(
    OCR_BLOCK_TUNING.edgeAlignmentTolerancePx,
    averageFlowSize * OCR_BLOCK_TUNING.edgeAlignmentToleranceMultiplier
  );
  const centerTolerance = Math.max(
    OCR_BLOCK_TUNING.centerAlignmentTolerancePx,
    Math.min(aAxis.lineSize, bAxis.lineSize) * OCR_BLOCK_TUNING.centerAlignmentToleranceRatio
  );
  const sameLine =
    flowOverlapRatio >= OCR_BLOCK_TUNING.sameLineOverlapRatio &&
    lineGap <= Math.max(
      OCR_BLOCK_TUNING.sameLineGapPx,
      averageFlowSize * OCR_BLOCK_TUNING.sameLineGapMultiplier
    );

  if (sameLine) {
    return true;
  }

  const alignedAlongLine =
    lineOverlapRatio >= OCR_BLOCK_TUNING.columnOverlapRatio ||
    Math.abs(aAxis.lineStart - bAxis.lineStart) <= edgeTolerance ||
    Math.abs(aAxis.lineEnd - bAxis.lineEnd) <= edgeTolerance ||
    Math.abs((aAxis.lineStart + aAxis.lineEnd) / 2 - (bAxis.lineStart + bAxis.lineEnd) / 2) <= centerTolerance;

  return (
    alignedAlongLine &&
    flowGap <= Math.max(
      OCR_BLOCK_TUNING.paragraphMergeGapPx,
      averageFlowSize * OCR_BLOCK_TUNING.paragraphMergeGapMultiplier
    )
  );
}

function joinGroupText(members, orientation) {
  const sorted = [...members].sort(getReadingOrderComparator(orientation));
  let combined = '';
  let previous = '';

  for (const member of sorted) {
    const nextText = String(member.text || '').replace(/\s+/g, ' ').trim();
    if (!nextText) continue;

    if (!combined) {
      combined = nextText;
      previous = nextText;
      continue;
    }

    combined += shouldInsertSpace(previous, nextText) ? ` ${nextText}` : nextText;
    previous = nextText;
  }

  return combined.trim();
}

function normalizeRawBlock(rawBlock, index) {
  const bbox = rawBlock?.bbox || {};
  const width = Math.max(0, Number(bbox.width) || 0);
  const height = Math.max(0, Number(bbox.height) || 0);

  return {
    id: index,
    text: String(rawBlock?.text || '').trim(),
    confidence: Number(rawBlock?.confidence) || 0,
    orientation: rawBlock?.orientation === 'vertical' ? 'vertical' : 'horizontal',
    bbox: {
      x: Number(bbox.x) || 0,
      y: Number(bbox.y) || 0,
      width,
      height
    }
  };
}

export function groupTextBlocks(ocrResults = []) {
  const normalized = ocrResults
    .map(normalizeRawBlock)
    .filter((block) => block.text && block.bbox.width > 1 && block.bbox.height > 1);

  if (normalized.length <= 1) {
    return normalized.map((block, index) => ({
      ...block,
      id: `block-${index}`,
      rawIds: [block.id],
      rawBoxes: [block.bbox],
      alignment: detectBlockAlignment([block], block.orientation, block.bbox),
      members: [block]
    }));
  }

  const parent = normalized.map((_, index) => index);

  function find(index) {
    if (parent[index] !== index) {
      parent[index] = find(parent[index]);
    }
    return parent[index];
  }

  function union(aIndex, bIndex) {
    const rootA = find(aIndex);
    const rootB = find(bIndex);
    if (rootA !== rootB) {
      parent[rootB] = rootA;
    }
  }

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (canMergeBlocks(normalized[i], normalized[j])) {
        union(i, j);
      }
    }
  }

  const groups = new Map();

  normalized.forEach((block, index) => {
    const root = find(index);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root).push(block);
  });

  const mergedBlocks = [...groups.values()]
    .map((members, index) => {
      const verticalCount = members.filter((member) => member.orientation === 'vertical').length;
      const orientation = verticalCount > members.length / 2 ? 'vertical' : 'horizontal';
      const bbox = unionBoxes(members.map((member) => member.bbox));
      const confidence =
        members.reduce((sum, member) => sum + member.confidence, 0) / Math.max(1, members.length);

      return {
        id: `block-${index}`,
        text: joinGroupText(members, orientation),
        confidence,
        orientation,
        bbox,
        alignment: detectBlockAlignment(members, orientation, bbox),
        rawIds: members.map((member) => member.id),
        rawBoxes: members.map((member) => member.bbox),
        members
      };
    })
    .filter((block) => block.text.length > 0)
    .sort(getReadingOrderComparator('horizontal'));

  return mergedBlocks;
}

function endsWithSpeechPause(text) {
  return /[.!?;:…。！？]$/.test(String(text || '').trim());
}

export function buildSpeechText(ocrResults = [], translations = []) {
  const segments = ocrResults
    .map((block, index) => ({
      ...(block || {}),
      translatedText: normalizeTranslationText(translations[index])
    }))
    .filter((block) => block.translatedText.length > 0)
    .sort(getReadingOrderComparator('horizontal'));

  let speechText = '';

  for (const segment of segments) {
    if (!speechText) {
      speechText = segment.translatedText;
      continue;
    }

    speechText += endsWithSpeechPause(speechText)
      ? ` ${segment.translatedText}`
      : `. ${segment.translatedText}`;
  }

  return speechText.trim();
}
