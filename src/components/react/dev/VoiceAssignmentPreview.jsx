import { useState } from 'react';
import EnsayoPersonalView from '../EnsayoPersonalView.jsx';

const previewSong = {
  id: 'voice-preview-song',
  title: 'Tengo un Refugio',
  artist: 'Vista local',
  sectionMarkers: [
    { id: 'intro', label: 'Intro', startSec: 0 },
    { id: 'verse-1', label: 'Verso 1', startSec: 18 },
    { id: 'chorus-1', label: 'Coro', startSec: 52 },
  ],
};

const previewTracks = [
  { label: 'Voz Guía', url: 'https://example.com/voz-guia.wav' },
  { label: 'Tercera', url: 'https://example.com/tercera.wav' },
  { label: 'Quinta', url: 'https://example.com/quinta.wav' },
  { label: 'Todas las Voces', url: 'https://example.com/todas-las-voces.wav' },
];

const previewMembers = [
  {
    id: 'member-oscar',
    name: 'Óscar Delgado',
    roleLabel: 'Voz',
    avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Oscar',
  },
  {
    id: 'member-sarah',
    name: 'Sarah Méndez',
    roleLabel: 'Voz líder',
    avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Sarah',
  },
  {
    id: 'member-daniel',
    name: 'Daniel Rojas',
    roleLabel: 'Voz',
    avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Daniel',
  },
  {
    id: 'member-nathalie',
    name: 'Nathalie Pérez',
    roleLabel: 'Voz',
    avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Nathalie',
  },
  {
    id: 'member-camila',
    name: 'Camila Torres',
    roleLabel: 'Voz',
    avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Camila',
  },
  {
    id: 'member-luis',
    name: 'Luis Herrera',
    roleLabel: 'Voz',
    avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Luis',
  },
];

const initialAssignments = {
  [previewSong.id]: {
    'member-oscar': { trackName: 'Voz Guía' },
    'member-sarah': { trackName: 'Voz Guía' },
    'member-nathalie': { trackName: 'Tercera' },
    __trackAnchors: {
      'Voz Guía': { sectionId: 'verse-1', sectionLabel: 'Verso 1', startSec: 16, preRollSec: 2 },
    },
  },
};

export default function VoiceAssignmentPreview({ initialVoiceCount = 4 }) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const showSaved = (message) => {
    setFeedback({ type: 'success', message });
    window.setTimeout(() => setFeedback(null), 1800);
  };

  const saveAssignment = async ({ songId, targetUserId, trackName }) => {
    setIsSaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 260));
    setAssignments((current) => ({
      ...current,
      [songId]: {
        ...(current[songId] || {}),
        [targetUserId]: { trackName },
      },
    }));
    setIsSaving(false);
    showSaved('Asignación guardada en la vista local.');
  };

  const clearAssignment = async ({ songId, targetUserId }) => {
    setAssignments((current) => {
      const nextSongAssignments = { ...(current[songId] || {}) };
      delete nextSongAssignments[targetUserId];
      return { ...current, [songId]: nextSongAssignments };
    });
    showSaved('Asignación eliminada en la vista local.');
  };

  return (
    <EnsayoPersonalView
      song={previewSong}
      contextTitle="Ensayo · Vista vocal"
      userId="member-daniel"
      tracksOriginales={previewTracks}
      songVoiceAssignments={assignments}
      memberOptions={previewMembers.slice(0, Math.max(4, Math.min(6, Number(initialVoiceCount) || 4)))}
      canEdit
      canAssignVoices
      canEditVoiceStarts
      isSavingAssignments={isSaving}
      saveFeedback={feedback}
      onBack={() => {}}
      onTrackPlay={() => {}}
      onSaveAssignment={saveAssignment}
      onClearAssignment={clearAssignment}
      onSaveTrackAnchor={async () => showSaved('Comienzo guardado en la vista local.')}
    />
  );
}
