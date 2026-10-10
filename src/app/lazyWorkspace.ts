import { signal } from '@preact/signals';
import type { ComponentType } from 'preact';

/**
 * L'area delle note (editor, anteprima, raccolta, ricerca) arriva con import() solo quando
 * serve: le schermate di blocco restano leggere e non scaricano CodeMirror, markdown-it,
 * DOMPurify né la raccolta. Il caricamento parte insieme alla derivazione della chiave.
 */
export const workspaceComponent = signal<ComponentType | null>(null);
export const workspaceLoadFailed = signal(false);

let loading: Promise<void> | undefined;

export function loadWorkspace(): Promise<void> {
  loading ??= import('./Workspace').then(
    (module) => {
      workspaceComponent.value = module.Workspace;
      workspaceLoadFailed.value = false;
    },
    (error: unknown) => {
      // Per esempio un aggiornamento pubblicato nel frattempo: i file vecchi non ci sono più.
      console.error(error);
      loading = undefined;
      workspaceLoadFailed.value = true;
    },
  );
  return loading;
}
