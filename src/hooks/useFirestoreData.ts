import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type {
  CalendarEvent,
  Contact,
  ContactCategory,
  DailyTask,
  NoteFolder,
  QuickNote,
  TaskPriority,
  TaskQuadrant,
} from '../types';
import { clampString } from '../lib/utils';

export function useFirestoreData() {
  const { user, authReady, profileReady } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authReady || !user || !profileReady) {
      if (authReady && !user) {
        setEvents([]);
        setTasks([]);
        setContacts([]);
        setNotes([]);
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    let loadedFlags = { events: false, tasks: false, contacts: false, notes: false };
    const checkDone = () => {
      if (loadedFlags.events && loadedFlags.tasks && loadedFlags.contacts && loadedFlags.notes) {
        setLoading(false);
      }
    };

    const eventsPath = `users/${user.uid}/events`;
    const eventsQuery = query(collection(db, eventsPath), where('userId', '==', user.uid));
    const unsubEvents = onSnapshot(
      eventsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CalendarEvent, 'id'>) }));
        list.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
        setEvents(list);
        loadedFlags.events = true;
        checkDone();
      },
      (error) => handleFirestoreError(error, OperationType.LIST, eventsPath)
    );

    const tasksPath = `users/${user.uid}/tasks`;
    const tasksQuery = query(collection(db, tasksPath), where('userId', '==', user.uid));
    const unsubTasks = onSnapshot(
      tasksQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DailyTask, 'id'>) }));
        list.sort((a, b) => {
          if (a.completed !== b.completed) return a.completed ? 1 : -1;
          if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
          return a.dueDate.localeCompare(b.dueDate);
        });
        setTasks(list);
        loadedFlags.tasks = true;
        checkDone();
      },
      (error) => handleFirestoreError(error, OperationType.LIST, tasksPath)
    );

    const contactsPath = `users/${user.uid}/contacts`;
    const contactsQuery = query(collection(db, contactsPath), where('userId', '==', user.uid));
    const unsubContacts = onSnapshot(
      contactsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Contact, 'id'>) }));
        list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
        setContacts(list);
        loadedFlags.contacts = true;
        checkDone();
      },
      (error) => handleFirestoreError(error, OperationType.LIST, contactsPath)
    );

    const notesPath = `users/${user.uid}/notes`;
    const notesQuery = query(collection(db, notesPath), where('userId', '==', user.uid));
    const unsubNotes = onSnapshot(
      notesQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<QuickNote, 'id'>) }));
        list.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          const aTime = a.updatedAt?.toMillis?.() || 0;
          const bTime = b.updatedAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
        setNotes(list);
        loadedFlags.notes = true;
        checkDone();
      },
      (error) => handleFirestoreError(error, OperationType.LIST, notesPath)
    );

    return () => {
      unsubEvents();
      unsubTasks();
      unsubContacts();
      unsubNotes();
    };
  }, [authReady, user, profileReady]);

  // --- Events CRUD ---
  const createEvent = async (input: {
    title: string;
    description: string;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    isImportant: boolean;
    reminderMinutes: number;
    contactId: string;
    contactName: string;
    whatsappReminderEnabled: boolean;
  }) => {
    if (!user) return;
    const path = `users/${user.uid}/events`;
    try {
      await addDoc(collection(db, path), {
        userId: user.uid,
        title: clampString(input.title, 160) || 'Cita sin título',
        description: clampString(input.description, 1000),
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        location: clampString(input.location, 200),
        isImportant: Boolean(input.isImportant),
        reminderMinutes: Math.min(1440, Math.max(0, Math.round(input.reminderMinutes))),
        alarmDismissed: false,
        contactId: clampString(input.contactId, 128),
        contactName: clampString(input.contactName, 120),
        whatsappReminderEnabled: Boolean(input.whatsappReminderEnabled),
        whatsappConfirmationSent: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const updateEvent = async (
    eventId: string,
    patch: Partial<{
      title: string;
      description: string;
      date: string;
      startTime: string;
      endTime: string;
      location: string;
      isImportant: boolean;
      reminderMinutes: number;
      alarmDismissed: boolean;
      contactId: string;
      contactName: string;
      whatsappReminderEnabled: boolean;
      whatsappConfirmationSent: boolean;
    }>
  ) => {
    if (!user) return;
    const path = `users/${user.uid}/events/${eventId}`;
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.title !== undefined) payload.title = clampString(patch.title, 160) || 'Cita sin título';
    if (patch.description !== undefined) payload.description = clampString(patch.description, 1000);
    if (patch.date !== undefined) payload.date = patch.date;
    if (patch.startTime !== undefined) payload.startTime = patch.startTime;
    if (patch.endTime !== undefined) payload.endTime = patch.endTime;
    if (patch.location !== undefined) payload.location = clampString(patch.location, 200);
    if (patch.isImportant !== undefined) payload.isImportant = Boolean(patch.isImportant);
    if (patch.reminderMinutes !== undefined) {
      payload.reminderMinutes = Math.min(1440, Math.max(0, Math.round(patch.reminderMinutes)));
    }
    if (patch.alarmDismissed !== undefined) payload.alarmDismissed = Boolean(patch.alarmDismissed);
    if (patch.contactId !== undefined) payload.contactId = clampString(patch.contactId, 128);
    if (patch.contactName !== undefined) payload.contactName = clampString(patch.contactName, 120);
    if (patch.whatsappReminderEnabled !== undefined) {
      payload.whatsappReminderEnabled = Boolean(patch.whatsappReminderEnabled);
    }
    if (patch.whatsappConfirmationSent !== undefined) {
      payload.whatsappConfirmationSent = Boolean(patch.whatsappConfirmationSent);
    }
    try {
      await updateDoc(doc(db, path), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const deleteEvent = async (eventId: string) => {
    if (!user) return;
    const path = `users/${user.uid}/events/${eventId}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  // --- Tasks CRUD ---
  const createTask = async (input: {
    title: string;
    notes: string;
    dueDate: string;
    priority: TaskPriority;
    quadrant: TaskQuadrant;
    estimatedMinutes: number;
    orderIndex?: number;
    aiReason?: string;
  }) => {
    if (!user) return;
    const path = `users/${user.uid}/tasks`;
    try {
      await addDoc(collection(db, path), {
        userId: user.uid,
        title: clampString(input.title, 200) || 'Tarea sin título',
        notes: clampString(input.notes, 1000),
        dueDate: input.dueDate,
        priority: input.priority,
        quadrant: input.quadrant,
        estimatedMinutes: Math.min(1440, Math.max(1, Math.round(input.estimatedMinutes))),
        orderIndex: input.orderIndex ?? tasks.length,
        completed: false,
        aiReason: clampString(input.aiReason || '', 400),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const updateTask = async (
    taskId: string,
    patch: Partial<{
      title: string;
      notes: string;
      dueDate: string;
      priority: TaskPriority;
      quadrant: TaskQuadrant;
      estimatedMinutes: number;
      orderIndex: number;
      completed: boolean;
      aiReason: string;
    }>
  ) => {
    if (!user) return;
    const path = `users/${user.uid}/tasks/${taskId}`;
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.title !== undefined) payload.title = clampString(patch.title, 200) || 'Tarea sin título';
    if (patch.notes !== undefined) payload.notes = clampString(patch.notes, 1000);
    if (patch.dueDate !== undefined) payload.dueDate = patch.dueDate;
    if (patch.priority !== undefined) payload.priority = patch.priority;
    if (patch.quadrant !== undefined) payload.quadrant = patch.quadrant;
    if (patch.estimatedMinutes !== undefined) {
      payload.estimatedMinutes = Math.min(1440, Math.max(1, Math.round(patch.estimatedMinutes)));
    }
    if (patch.orderIndex !== undefined) {
      payload.orderIndex = Math.min(10000, Math.max(0, Math.round(patch.orderIndex)));
    }
    if (patch.completed !== undefined) payload.completed = Boolean(patch.completed);
    if (patch.aiReason !== undefined) payload.aiReason = clampString(patch.aiReason, 400);
    try {
      await updateDoc(doc(db, path), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const applyBatchTaskPrioritization = async (
    updates: Array<{
      id: string;
      priority: TaskPriority;
      quadrant: TaskQuadrant;
      orderIndex: number;
      aiReason: string;
    }>
  ) => {
    if (!user || updates.length === 0) return;
    const path = `users/${user.uid}/tasks`;
    try {
      const batch = writeBatch(db);
      for (const item of updates) {
        const ref = doc(db, path, item.id);
        batch.update(ref, {
          priority: item.priority,
          quadrant: item.quadrant,
          orderIndex: Math.min(10000, Math.max(0, Math.round(item.orderIndex))),
          aiReason: clampString(item.aiReason, 400),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!user) return;
    const path = `users/${user.uid}/tasks/${taskId}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  // --- Contacts CRUD ---
  const createContact = async (input: {
    name: string;
    phone: string;
    email: string;
    role: string;
    category: ContactCategory;
    notes: string;
  }) => {
    if (!user) return;
    const path = `users/${user.uid}/contacts`;
    try {
      await addDoc(collection(db, path), {
        userId: user.uid,
        name: clampString(input.name, 120) || 'Contacto',
        phone: clampString(input.phone, 24),
        email: clampString(input.email, 254),
        role: clampString(input.role, 120),
        category: input.category,
        notes: clampString(input.notes, 1000),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const updateContact = async (
    contactId: string,
    patch: Partial<{
      name: string;
      phone: string;
      email: string;
      role: string;
      category: ContactCategory;
      notes: string;
    }>
  ) => {
    if (!user) return;
    const path = `users/${user.uid}/contacts/${contactId}`;
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.name !== undefined) payload.name = clampString(patch.name, 120) || 'Contacto';
    if (patch.phone !== undefined) payload.phone = clampString(patch.phone, 24);
    if (patch.email !== undefined) payload.email = clampString(patch.email, 254);
    if (patch.role !== undefined) payload.role = clampString(patch.role, 120);
    if (patch.category !== undefined) payload.category = patch.category;
    if (patch.notes !== undefined) payload.notes = clampString(patch.notes, 1000);
    try {
      await updateDoc(doc(db, path), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const deleteContact = async (contactId: string) => {
    if (!user) return;
    const path = `users/${user.uid}/contacts/${contactId}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  // --- Notes CRUD ---
  const createNote = async (input: {
    title: string;
    content: string;
    rawText: string;
    folder: NoteFolder;
    tags: string[];
    pinned: boolean;
    isOrganized: boolean;
  }) => {
    if (!user) return;
    const path = `users/${user.uid}/notes`;
    const safeTags = input.tags
      .slice(0, 8)
      .map((t) => clampString(t, 40))
      .filter(Boolean);
    try {
      await addDoc(collection(db, path), {
        userId: user.uid,
        title: clampString(input.title, 160) || 'Nota rápida',
        content: clampString(input.content, 8000),
        rawText: clampString(input.rawText, 4000),
        folder: input.folder,
        tags: safeTags,
        pinned: Boolean(input.pinned),
        isOrganized: Boolean(input.isOrganized),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const updateNote = async (
    noteId: string,
    patch: Partial<{
      title: string;
      content: string;
      rawText: string;
      folder: NoteFolder;
      tags: string[];
      pinned: boolean;
      isOrganized: boolean;
    }>
  ) => {
    if (!user) return;
    const path = `users/${user.uid}/notes/${noteId}`;
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.title !== undefined) payload.title = clampString(patch.title, 160) || 'Nota rápida';
    if (patch.content !== undefined) payload.content = clampString(patch.content, 8000);
    if (patch.rawText !== undefined) payload.rawText = clampString(patch.rawText, 4000);
    if (patch.folder !== undefined) payload.folder = patch.folder;
    if (patch.tags !== undefined) {
      payload.tags = patch.tags
        .slice(0, 8)
        .map((t) => clampString(t, 40))
        .filter(Boolean);
    }
    if (patch.pinned !== undefined) payload.pinned = Boolean(patch.pinned);
    if (patch.isOrganized !== undefined) payload.isOrganized = Boolean(patch.isOrganized);
    try {
      await updateDoc(doc(db, path), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!user) return;
    const path = `users/${user.uid}/notes/${noteId}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  return {
    events,
    tasks,
    contacts,
    notes,
    loading,
    createEvent,
    updateEvent,
    deleteEvent,
    createTask,
    updateTask,
    applyBatchTaskPrioritization,
    deleteTask,
    createContact,
    updateContact,
    deleteContact,
    createNote,
    updateNote,
    deleteNote,
  };
}
