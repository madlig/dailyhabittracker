import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

type Category = 'Focus' | 'Health' | 'Learning' | 'Career' | 'Life';
type Filter = 'all' | 'pending' | 'done';

type Habit = {
  id: string;
  title: string;
  category: Category;
  priority: 1 | 2 | 3;
  completionDates: string[];
  reminderEnabled: boolean;
  reminderTime: string;
  notificationId: string | null;
  createdAt: string;
};

type HabitDraft = {
  title: string;
  category: Category;
  priority: 1 | 2 | 3;
  reminderEnabled: boolean;
  reminderTime: string;
};

const STORAGE_KEY = 'modern_habit_tracker_v3';
const TIME_PRESETS = ['06:30', '07:00', '12:00', '18:00', '20:00', '21:30'];
const CATEGORIES: Category[] = ['Focus', 'Health', 'Learning', 'Career', 'Life'];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const dayKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseTime = (value: string) => {
  const [hourRaw, minuteRaw] = value.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
};

const getStreak = (completionDates: string[]) => {
  const set = new Set(completionDates);
  const cursor = new Date();
  let streak = 0;
  while (set.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

const getPriorityLabel = (priority: 1 | 2 | 3) => {
  if (priority === 3) return 'High';
  if (priority === 2) return 'Medium';
  return 'Low';
};

export default function App() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [focusSeconds, setFocusSeconds] = useState(25 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [draft, setDraft] = useState<HabitDraft>({
    title: '',
    category: 'Focus',
    priority: 3,
    reminderEnabled: true,
    reminderTime: '20:00',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          setHabits(JSON.parse(raw) as Habit[]);
        }
      } catch (error) {
        console.log('Load failed', error);
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(habits)).catch((error) => {
      console.log('Save failed', error);
    });
  }, [habits, loaded]);

  useEffect(() => {
    if (!focusRunning) return;
    if (focusSeconds <= 0) {
      setFocusRunning(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
      Alert.alert('Focus complete', 'Sprint 25 menit selesai. Lanjut habit berikutnya!');
      setFocusSeconds(25 * 60);
      return;
    }

    const id = setInterval(() => {
      setFocusSeconds((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(id);
  }, [focusRunning, focusSeconds]);

  const today = dayKey();
  const doneToday = useMemo(() => habits.filter((h) => h.completionDates.includes(today)).length, [habits, today]);
  const progress = habits.length === 0 ? 0 : Math.round((doneToday / habits.length) * 100);
  const bestStreak = habits.reduce((max, habit) => Math.max(max, getStreak(habit.completionDates)), 0);

  const visibleHabits = useMemo(() => {
    return habits
      .filter((habit) => {
        const byText = habit.title.toLowerCase().includes(query.toLowerCase().trim());
        const isDone = habit.completionDates.includes(today);
        const byFilter = filter === 'all' || (filter === 'done' && isDone) || (filter === 'pending' && !isDone);
        return byText && byFilter;
      })
      .sort((a, b) => b.priority - a.priority);
  }, [habits, query, filter, today]);

  const topFocusHabit = visibleHabits.find((habit) => !habit.completionDates.includes(today)) ?? visibleHabits[0] ?? null;

  const requestReminderPermission = async () => {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted') return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.status === 'granted';
  };

  const scheduleReminder = async (habit: Habit) => {
    const allowed = await requestReminderPermission();
    if (!allowed) {
      Alert.alert('Permission needed', 'Izinkan notifikasi agar reminder habit bisa aktif.');
      return null;
    }

    const parsed = parseTime(habit.reminderTime);
    if (!parsed) {
      Alert.alert('Invalid time', 'Format jam reminder harus HH:MM.');
      return null;
    }

    const trigger: Notifications.DailyTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: parsed.hour,
      minute: parsed.minute,
    };

    return Notifications.scheduleNotificationAsync({
      content: {
        title: `Habit Reminder: ${habit.title}`,
        body: 'Small step today beats perfect plan tomorrow.',
      },
      trigger,
    });
  };

  const addHabit = async () => {
    const title = draft.title.trim();
    if (!title) return;

    const base: Habit = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      category: draft.category,
      priority: draft.priority,
      completionDates: [],
      reminderEnabled: draft.reminderEnabled,
      reminderTime: draft.reminderTime,
      notificationId: null,
      createdAt: new Date().toISOString(),
    };

    let notificationId: string | null = null;
    if (base.reminderEnabled) {
      notificationId = await scheduleReminder(base);
    }

    const finalHabit = { ...base, reminderEnabled: notificationId ? base.reminderEnabled : false, notificationId };
    setHabits((prev) => [finalHabit, ...prev]);
    setDraft({
      title: '',
      category: 'Focus',
      priority: 3,
      reminderEnabled: true,
      reminderTime: '20:00',
    });
    setShowCreate(false);
  };

  const toggleDone = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    setHabits((prev) =>
      prev.map((habit) => {
        if (habit.id !== id) return habit;
        const done = habit.completionDates.includes(today);
        return {
          ...habit,
          completionDates: done ? habit.completionDates.filter((d) => d !== today) : [...habit.completionDates, today],
        };
      })
    );
  };

  const removeHabit = async (id: string) => {
    const target = habits.find((h) => h.id === id);
    if (target?.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(target.notificationId).catch(() => null);
    }
    setHabits((prev) => prev.filter((habit) => habit.id !== id));
  };

  const toggleReminder = async (id: string) => {
    const target = habits.find((h) => h.id === id);
    if (!target) return;

    if (target.reminderEnabled) {
      if (target.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(target.notificationId).catch(() => null);
      }
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, reminderEnabled: false, notificationId: null } : h)));
      return;
    }

    const notificationId = await scheduleReminder(target);
    if (!notificationId) return;
    setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, reminderEnabled: true, notificationId } : h)));
  };

  const cycleReminderTime = async (id: string) => {
    const target = habits.find((h) => h.id === id);
    if (!target) return;
    const idx = TIME_PRESETS.indexOf(target.reminderTime);
    const nextTime = TIME_PRESETS[(idx + 1) % TIME_PRESETS.length];

    let nextNotificationId = target.notificationId;
    if (target.reminderEnabled) {
      if (target.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(target.notificationId).catch(() => null);
      }
      nextNotificationId = await scheduleReminder({ ...target, reminderTime: nextTime });
    }

    setHabits((prev) =>
      prev.map((habit) =>
        habit.id === id
          ? {
              ...habit,
              reminderTime: nextTime,
              reminderEnabled: target.reminderEnabled ? Boolean(nextNotificationId) : habit.reminderEnabled,
              notificationId: target.reminderEnabled ? nextNotificationId : habit.notificationId,
            }
          : habit
      )
    );
  };

  const formatFocusTime = (totalSeconds: number) => {
    const minute = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const second = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minute}:${second}`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <LinearGradient colors={['#0b1120', '#1e293b', '#0f766e']} style={styles.header}>
        <Text style={styles.brand}>NOVA HABITS</Text>
        <Text style={styles.tagline}>Lebih fokus, lebih tertata, tanpa ribet</Text>
        <Text style={styles.progressText}>{doneToday}/{habits.length} selesai hari ini • {progress}%</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      </LinearGradient>

      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.focusCard}>
          <View style={styles.focusTopRow}>
            <Text style={styles.focusTitle}>Focus Sprint</Text>
            <Pressable onPress={() => setShowCreate(true)} style={styles.newHabitButton}>
              <Text style={styles.newHabitButtonText}>+ Habit</Text>
            </Pressable>
          </View>
          <Text style={styles.focusHabit}>{topFocusHabit ? topFocusHabit.title : 'Belum ada habit aktif'}</Text>
          <View style={styles.focusTimerRow}>
            <Text style={styles.focusTimer}>{formatFocusTime(focusSeconds)}</Text>
            <Pressable
              style={styles.focusAction}
              onPress={() => {
                if (!focusRunning && focusSeconds <= 0) setFocusSeconds(25 * 60);
                setFocusRunning((prev) => !prev);
              }}
            >
              <Text style={styles.focusActionText}>{focusRunning ? 'Pause' : 'Start 25m'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Best Streak</Text>
            <Text style={styles.metricValue}>{bestStreak}d</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Pending</Text>
            <Text style={styles.metricValue}>{Math.max(0, habits.length - doneToday)}</Text>
          </View>
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Cari habit kamu"
          placeholderTextColor="#94a3b8"
          style={styles.searchInput}
        />

        <View style={styles.filterRow}>
          {(['pending', 'all', 'done'] as Filter[]).map((item) => (
            <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filterChip, filter === item && styles.filterChipActive]}>
              <Text style={[styles.filterChipText, filter === item && styles.filterChipTextActive]}>{item.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {visibleHabits.map((habit) => {
            const done = habit.completionDates.includes(today);
            const streak = getStreak(habit.completionDates);
            return (
              <View key={habit.id} style={styles.habitCard}>
                <View style={styles.habitTopRow}>
                  <View style={styles.habitIdentity}>
                    <Text style={styles.habitTitle}>{habit.title}</Text>
                    <Text style={styles.habitMeta}>
                      {habit.category} • {getPriorityLabel(habit.priority)} priority • Streak {streak}
                    </Text>
                  </View>
                  <Pressable onPress={() => removeHabit(habit.id)} style={styles.deleteButton}>
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </Pressable>
                </View>

                <View style={styles.habitActionsRow}>
                  <Pressable onPress={() => toggleDone(habit.id)} style={[styles.doneButton, done && styles.doneButtonActive]}>
                    <Text style={[styles.doneButtonText, done && styles.doneButtonTextActive]}>{done ? 'Done Today' : 'Mark Done'}</Text>
                  </Pressable>

                  <Pressable onPress={() => cycleReminderTime(habit.id)} style={styles.timeButton}>
                    <Text style={styles.timeButtonText}>{habit.reminderTime}</Text>
                  </Pressable>

                  <View style={styles.reminderSwitchWrap}>
                    <Text style={styles.reminderSwitchText}>Remind</Text>
                    <Switch value={habit.reminderEnabled} onValueChange={() => toggleReminder(habit.id)} />
                  </View>
                </View>
              </View>
            );
          })}

          {visibleHabits.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Tidak ada habit di filter ini</Text>
              <Text style={styles.emptyText}>Coba ganti filter atau tambah habit baru dari tombol + Habit.</Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Habit</Text>

            <TextInput
              value={draft.title}
              onChangeText={(value) => setDraft((prev) => ({ ...prev, title: value }))}
              placeholder="Contoh: Deep work 60 menit"
              placeholderTextColor="#94a3b8"
              style={styles.modalInput}
            />

            <Text style={styles.modalLabel}>Category</Text>
            <View style={styles.modalChipRow}>
              {CATEGORIES.map((category) => (
                <Pressable
                  key={category}
                  onPress={() => setDraft((prev) => ({ ...prev, category }))}
                  style={[styles.modalChip, draft.category === category && styles.modalChipActive]}
                >
                  <Text style={[styles.modalChipText, draft.category === category && styles.modalChipTextActive]}>{category}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.modalLabel}>Priority</Text>
            <View style={styles.modalChipRow}>
              {[1, 2, 3].map((priority) => (
                <Pressable
                  key={priority}
                  onPress={() => setDraft((prev) => ({ ...prev, priority: priority as 1 | 2 | 3 }))}
                  style={[styles.modalChip, draft.priority === priority && styles.modalChipActive]}
                >
                  <Text style={[styles.modalChipText, draft.priority === priority && styles.modalChipTextActive]}>
                    {getPriorityLabel(priority as 1 | 2 | 3)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.modalReminderRow}>
              <Text style={styles.modalLabel}>Reminder</Text>
              <Switch
                value={draft.reminderEnabled}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, reminderEnabled: value }))}
              />
            </View>

            <View style={styles.modalChipRow}>
              {TIME_PRESETS.map((time) => (
                <Pressable
                  key={time}
                  onPress={() => setDraft((prev) => ({ ...prev, reminderTime: time }))}
                  style={[styles.modalChip, draft.reminderTime === time && styles.modalChipActive]}
                >
                  <Text style={[styles.modalChipText, draft.reminderTime === time && styles.modalChipTextActive]}>{time}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.modalActions}>
              <Pressable style={styles.cancelButton} onPress={() => setShowCreate(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={addHabit}>
                <Text style={styles.saveButtonText}>Save Habit</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#e2e8f0',
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  brand: {
    color: '#f8fafc',
    fontSize: 30,
    fontFamily: Platform.select({ ios: 'AvenirNext-Bold', android: 'sans-serif-medium', default: 'sans-serif' }),
    letterSpacing: 0.6,
  },
  tagline: {
    marginTop: 6,
    color: '#cbd5e1',
    fontSize: 14,
  },
  progressText: {
    marginTop: 14,
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14,
  },
  progressTrack: {
    marginTop: 8,
    height: 10,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#34d399',
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  focusCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 14,
  },
  focusTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  focusTitle: {
    color: '#7dd3fc',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  newHabitButton: {
    borderRadius: 999,
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  newHabitButtonText: {
    color: '#f0f9ff',
    fontWeight: '700',
    fontSize: 12,
  },
  focusHabit: {
    marginTop: 10,
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
  },
  focusTimerRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  focusTimer: {
    color: '#22d3ee',
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  focusAction: {
    borderRadius: 12,
    backgroundColor: '#14b8a6',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  focusActionText: {
    color: '#042f2e',
    fontWeight: '800',
    fontSize: 13,
  },
  metricsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 12,
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  metricValue: {
    marginTop: 4,
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '800',
  },
  searchInput: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#0f172a',
    fontSize: 15,
  },
  filterRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  filterChipActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  filterChipText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#f8fafc',
  },
  list: {
    paddingTop: 10,
    paddingBottom: 24,
    gap: 10,
  },
  habitCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe4f0',
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  habitTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  habitIdentity: {
    flex: 1,
  },
  habitTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  habitMeta: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 12,
  },
  deleteButton: {
    borderRadius: 10,
    backgroundColor: '#fee2e2',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  deleteButtonText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '700',
  },
  habitActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  doneButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    paddingVertical: 10,
    alignItems: 'center',
  },
  doneButtonActive: {
    backgroundColor: '#16a34a',
  },
  doneButtonText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 12,
  },
  doneButtonTextActive: {
    color: '#f0fdf4',
  },
  timeButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 10,
    paddingHorizontal: 11,
  },
  timeButtonText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 12,
  },
  reminderSwitchWrap: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reminderSwitchText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    padding: 14,
  },
  emptyTitle: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 14,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 10,
  },
  modalTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '800',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#0f172a',
  },
  modalLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  modalChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalChipActive: {
    borderColor: '#0284c7',
    backgroundColor: '#e0f2fe',
  },
  modalChipText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  modalChipTextActive: {
    color: '#075985',
  },
  modalReminderRow: {
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalActions: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    paddingVertical: 11,
  },
  cancelButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  saveButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#0284c7',
    alignItems: 'center',
    paddingVertical: 11,
  },
  saveButtonText: {
    color: '#f8fafc',
    fontWeight: '800',
  },
});
