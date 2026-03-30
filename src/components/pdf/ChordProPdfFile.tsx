import React from 'react';
import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ChordProPdfPayload } from '../../lib/chordproPdfPayload';
import {
  distributePdfBlocks,
  getPdfSongMap,
  getPreparedPdfBlocks,
} from '../../lib/chordproPdfLayout';
import type { PdfPreparedBlock } from '../../lib/chordproPdfLayout';

Font.register({
  family: 'Adineue',
  fonts: [
    { src: '/fonts/redil/adineue-PRO-KZ-Light.ttf', fontWeight: 300 },
    { src: '/fonts/redil/adineuePRO-Regular.ttf', fontWeight: 400 },
    { src: '/fonts/redil/adineue-PRO-Bold.ttf', fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: {
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 18,
    backgroundColor: '#ffffff',
    color: '#111827',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    fontFamily: 'Adineue',
    fontSize: 19,
    lineHeight: 1.02,
    fontWeight: 700,
  },
  artist: {
    marginTop: 3,
    fontFamily: 'Adineue',
    fontSize: 9,
    color: '#6B7280',
  },
  metaGrid: {
    width: 92,
    gap: 6,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  metaLabel: {
    fontFamily: 'Adineue',
    fontSize: 7,
    color: '#6B7280',
    fontWeight: 700,
  },
  metaValue: {
    fontFamily: 'Courier-Bold',
    fontSize: 8,
    color: '#111827',
  },
  songMap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
    marginBottom: 8,
  },
  songMapPill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  songMapLabel: {
    fontFamily: 'Adineue',
    fontSize: 7,
    color: '#ffffff',
    fontWeight: 700,
  },
  columns: {
    flexDirection: 'row',
    gap: 12,
  },
  column: {
    flex: 1,
    gap: 8,
  },
  collapsedSection: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FAFAFA',
  },
  collapsedTitle: {
    fontFamily: 'Adineue',
    fontSize: 9,
    fontWeight: 700,
  },
  sectionWrap: {
    borderWidth: 1,
    borderColor: '#D4D4D8',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#ffffff',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionPill: {
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  sectionPillLabel: {
    fontFamily: 'Adineue',
    fontSize: 7,
    color: '#ffffff',
    fontWeight: 700,
  },
  sectionTitle: {
    fontFamily: 'Adineue',
    fontSize: 9,
    fontWeight: 700,
  },
  lineWrap: {
    marginBottom: 2,
  },
  chordsText: {
    fontFamily: 'Courier',
    fontSize: 8,
    lineHeight: 1.22,
    color: '#2563EB',
    fontWeight: 700,
  },
  lyricsText: {
    fontFamily: 'Courier',
    fontSize: 9,
    lineHeight: 1.22,
    color: '#111827',
  },
});

const buildMetaItems = (payload: ChordProPdfPayload) => [
  { label: 'Tono', value: String(payload.metadata.tone || '--') || '--' },
  { label: 'Capo', value: String(payload.metadata.capo || '--') || '--' },
  { label: 'Tempo', value: String(payload.metadata.tempo || '--') || '--' },
  { label: 'Time', value: String(payload.metadata.time || '--') || '--' },
];

const renderLine = (
  block: PdfPreparedBlock,
  line: PdfPreparedBlock['pdfLines'][number],
  renderMode: ChordProPdfPayload['sheetOptions']['renderMode'],
  key: string
) => {
  const chordGuide = (() => {
    const grouped = new Map<number, string[]>();

    for (const item of Array.isArray(line?.chords) ? line.chords : []) {
      const position = Number.isFinite(Number(item?.position))
        ? Math.max(0, Number(item.position))
        : 0;
      const chord = String(item?.chord || '').trim();
      if (!chord) continue;

      const existing = grouped.get(position) || [];
      existing.push(chord);
      grouped.set(position, existing);
    }

    const groupedChords = Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([position, chords]) => ({
        position,
        text: chords.join(' '),
      }));

    if (groupedChords.length === 0) return '';

    const lyrics = String(line?.lyrics || '');
    if (!lyrics.trim()) {
      return groupedChords.reduce((output, item, index) => {
        if (index === 0) return item.text;
        const previous = groupedChords[index - 1];
        const originalGap = Math.max(0, item.position - previous.position);
        const gapSize = Math.max(2, originalGap);
        return `${output}${' '.repeat(gapSize)}${item.text}`;
      }, '');
    }

    const totalLength = groupedChords.reduce(
      (maxLength, item) => Math.max(maxLength, item.position + item.text.length),
      lyrics.length
    );
    const buffer = Array.from({ length: Math.max(totalLength, 1) }, () => ' ');
    for (const item of groupedChords) {
      for (let index = 0; index < item.text.length; index += 1) {
        buffer[item.position + index] = item.text[index];
      }
    }
    return buffer.join('').trimEnd();
  })();

  const lyrics = String(line?.lyrics || '').length > 0 ? String(line?.lyrics || '') : '\u00A0';
  const shouldRenderLyricsRow = /[\p{L}\p{N}]/u.test(String(line?.lyrics || '').trim()) || !chordGuide;

  if (renderMode === 'chords-only') {
    if (!chordGuide) return null;
    return (
      <View key={key} style={styles.lineWrap}>
        <Text style={styles.chordsText}>{chordGuide}</Text>
      </View>
    );
  }

  if (renderMode === 'lyrics-only') {
    return (
      <View key={key} style={styles.lineWrap}>
        <Text style={styles.lyricsText}>{lyrics}</Text>
      </View>
    );
  }

  return (
    <View key={key} style={styles.lineWrap}>
      {chordGuide ? <Text style={styles.chordsText}>{chordGuide}</Text> : null}
      {shouldRenderLyricsRow ? <Text style={styles.lyricsText}>{lyrics}</Text> : null}
    </View>
  );
};

const renderBlock = (
  block: PdfPreparedBlock,
  renderMode: ChordProPdfPayload['sheetOptions']['renderMode']
) => {
  if (block.isCollapsed) {
    return (
      <View key={block.id} style={styles.collapsedSection} wrap={false}>
        <View style={[styles.sectionPill, { backgroundColor: block.colors.bg }]}>
          <Text style={styles.sectionPillLabel}>{block.typeMarker}</Text>
        </View>
        <Text style={[styles.collapsedTitle, { color: block.colors.text }]}>{block.fullTitle}</Text>
      </View>
    );
  }

  return (
    <View key={block.id} style={styles.sectionWrap} wrap={false}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionPill, { backgroundColor: block.colors.bg }]}>
          <Text style={styles.sectionPillLabel}>{block.typeMarker}</Text>
        </View>
        <Text style={[styles.sectionTitle, { color: block.colors.text }]}>{block.fullTitle}</Text>
      </View>
      {block.pdfLines.map((line, lineIndex) =>
        renderLine(block, line, renderMode, `${block.id}-${lineIndex}`)
      )}
    </View>
  );
};

export default function ChordProPdfFile({ payload }: { payload: ChordProPdfPayload }) {
  const preparedBlocks = getPreparedPdfBlocks(payload);
  const songMap = getPdfSongMap(preparedBlocks, payload.sheetOptions.showSongMap);
  const columns = distributePdfBlocks(preparedBlocks, payload.sheetOptions);
  const metaItems = buildMetaItems(payload);

  return (
    <Document title={payload.title || 'ChordPro PDF'} author={payload.artist || 'Alabanza'}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{payload.title || 'SIN TITULO'}</Text>
            {payload.artist ? <Text style={styles.artist}>{payload.artist}</Text> : null}
            {songMap.length > 0 ? (
              <View style={styles.songMap}>
                {songMap.map((marker, index) => {
                  const block = preparedBlocks.find((item) => item.typeMarker === marker) || preparedBlocks[index];
                  const color = block?.colors.bg || '#475569';
                  return (
                    <View key={`${marker}-${index}`} style={[styles.songMapPill, { backgroundColor: color }]}>
                      <Text style={styles.songMapLabel}>{marker}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>

          <View style={styles.metaGrid}>
            {metaItems.map((item) => (
              <View key={item.label} style={styles.metaRow}>
                <Text style={styles.metaLabel}>{item.label.toUpperCase()}:</Text>
                <Text style={styles.metaValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.columns}>
          {columns.map((columnBlocks, columnIndex) => (
            <View key={`column-${columnIndex}`} style={styles.column}>
              {columnBlocks.map((block) => renderBlock(block, payload.sheetOptions.renderMode))}
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}
