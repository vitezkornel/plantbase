'use client';

import { EventLog } from './event-log';
import { useLiveVoice } from './use-live-voice';
import styles from './voice-live.module.css';

const seconds = (ms: number | null): string =>
  ms === null ? '–' : `${(ms / 1000).toFixed(1)} s`;

export function LivePanel() {
  const { state, vad, filler, running, connect, disconnect, setVad, setFiller } =
    useLiveVoice();
  const isConnected = state.status === 'connected';
  const isBusy = state.status === 'connecting';

  return (
    <section className={styles.panel}>
      <p className={styles.tip}>
        Fülhallgató ajánlott: a hangszóróból visszajövő hang hamis barge-in-t
        (közbevágást) okoz.
      </p>

      <div className={styles.controls}>
        <button type="button" onClick={connect} disabled={isConnected || isBusy}>
          Kapcsolódás
        </button>
        <button
          type="button"
          className={styles.disconnect}
          onClick={disconnect}
          disabled={!isConnected && !isBusy}
        >
          Bontás
        </button>
      </div>

      <fieldset className={styles.options}>
        <legend>Beszédfelismerés (VAD)</legend>
        <label>
          <input
            type="radio"
            name="vad"
            checked={vad === 'server'}
            onChange={() => setVad('server')}
          />{' '}
          server_vad
        </label>
        <label>
          <input
            type="radio"
            name="vad"
            checked={vad === 'semantic'}
            onChange={() => setVad('semantic')}
          />{' '}
          semantic_vad
        </label>
      </fieldset>

      <label className={styles.options}>
        <input
          type="checkbox"
          checked={filler}
          onChange={(event) => setFiller(event.target.checked)}
        />{' '}
        Filler (várakoztató mondat) BE
      </label>

      <p role="status">
        {state.status === 'connected'
          ? `Kapcsolódva (${state.model ?? ''})`
          : state.status === 'connecting'
            ? 'Kapcsolódás…'
            : 'Nincs kapcsolat'}
        {state.demoOrders ? <span className={styles.demo}>DEMO rendelések</span> : null}
      </p>
      {state.error === null ? null : <p role="alert">{state.error}</p>}
      {state.escalated ? (
        <p className={styles.escalated}>Kollégának továbbítva</p>
      ) : null}

      <dl className={styles.silence}>
        <dt>Csend a beszéd végétől</dt>
        <dd>
          {seconds(running.sinceSpeechStopMs)} (utolsó:{' '}
          {seconds(state.lastSilence?.sinceSpeechStopMs ?? null)})
        </dd>
        <dt>Csend a tool-hívástól</dt>
        <dd>
          {seconds(running.sinceToolMs)} (utolsó:{' '}
          {seconds(state.lastSilence?.sinceToolMs ?? null)})
        </dd>
      </dl>

      <EventLog lines={state.lines} />
    </section>
  );
}
