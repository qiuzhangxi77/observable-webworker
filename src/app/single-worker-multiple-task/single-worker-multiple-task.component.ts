import { ChangeDetectionStrategy, Component, ElementRef, ViewChild } from '@angular/core';
import {
  animationFrameScheduler,
  asyncScheduler,
  combineLatest,
  concat,
  interval,
  Observable,
  of,
  ReplaySubject,
  Subject,
} from 'rxjs';
import {
  delay,
  filter,
  groupBy,
  map,
  mergeMap,
  observeOn,
  scan,
  shareReplay,
  startWith,
  switchMap,
  switchMapTo,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';
import { fromWorkerPool } from '../../../projects/observable-webworker/src/lib/from-worker-pool';
import { GoogleChartsService } from '../google-charts.service';
import { FileHashEvent, HashWorkerMessage, Thread } from '../hash-worker.types';
import TimelineOptions = google.visualization.TimelineOptions;

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'app-single-worker-multiple-task',
  templateUrl: './single-worker-multiple-task.component.html',
  styleUrls: ['./single-worker-multiple-task.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SingleWorkerMultipleTaskComponent {
  @ViewChild('timeline', { read: ElementRef }) private timelineComponent!: ElementRef;

  public files:File[];
  public index: number = 0;
  public dataTable: any = undefined;

  public multiFilesToHash: Subject<File[]> = new ReplaySubject(1);
  public workResult$ = this.multiFilesToHash.pipe(
    observeOn(asyncScheduler),
    switchMap(files => this.hashMultipleFiles(files)),
  );

  public filenames$ = this.multiFilesToHash.pipe(
    map(files => files.map(f => f.name)),
    shareReplay(1),
  );

  public eventsPool$: Subject<HashWorkerMessage> = new Subject();

  public completedFiles$: Observable<string[]> = this.filenames$.pipe(
    switchMap(() =>
      this.eventsPool$.pipe(
        groupBy(m => m.file),
        mergeMap(fileMessage$ =>
          fileMessage$.pipe(
            filter(e => e.fileEventType === FileHashEvent.HASH_RECEIVED),
            take(1),
          ),
        ),
        map(message => message.file),
        filter((filename): filename is string => !!filename),
        scan<string, string[]>((files, file) => [...files, file], []),
        startWith([]),
      ),
    ),
  );

  public complete$: Observable<boolean> = combineLatest([this.filenames$, this.completedFiles$]).pipe(
    map(([files, completedFiles]) => files.length === completedFiles.length),
  );

  public status$: Observable<string> = concat(of(null), this.complete$).pipe(
    map(isComplete => {
      switch (isComplete) {
        case null:
          return 'Waiting for file selection';
        case true:
          return 'Completed';
        case false:
          return 'Processing files';
      }
    }),
  );

  public eventListPool$: Observable<HashWorkerMessage[]> = this.eventsPool$.pipe(
    scan<HashWorkerMessage, HashWorkerMessage[]>((list, event) => {
      list.push(event);
      return list;
    }, []),
    map(events => {
      const lastEventMap = new Map();

      return events
        .sort((a, b) => a.timestamp.valueOf() - b.timestamp.valueOf())
        .map(event => {
          const lastEvent = lastEventMap.get(event.file);

          lastEventMap.set(event.file, event);

          return {
            ...event,
            millisSinceLast: lastEvent ? event.timestamp.valueOf() - lastEvent.timestamp.valueOf() : null,
          };
        });
    }),
  );

  public chartObserver$ = combineLatest([this.filenames$, this.googleChartService.getVisualisation('timeline')]).pipe(
    switchMap(([filenames, visualization]) => {
      const container = this.timelineComponent.nativeElement;
      const chart = new visualization.Timeline(container);
      let dataTable: any;
      let lastRow: any;
      if (!this.dataTable) {
        dataTable = new visualization.DataTable();
        dataTable.addColumn({ type: 'string', id: 'file' });
        dataTable.addColumn({ type: 'string', id: 'event' });
        dataTable.addColumn({ type: 'date', id: 'Start' });
        dataTable.addColumn({ type: 'date', id: 'End' });
        lastRow = new Map();
      } else {
        dataTable = this.dataTable;
        lastRow = this.lastRow;
      }

      // dataTable.addColumn({ type: 'string', id: 'file' });
      // dataTable.addColumn({ type: 'string', id: 'event' });
      // dataTable.addColumn({ type: 'date', id: 'Start' });
      // dataTable.addColumn({ type: 'date', id: 'End' });

      // const lastRow = new Map();

      const chartOptions: TimelineOptions & { hAxis: any } = {
        height: 0,
        hAxis: {
          minValue: new Date(),
          maxValue: new Date(new Date().valueOf() + 1000 * 20),
        },
      };

      const eventUpdates$ = this.eventsPool$.pipe(
        tap(event => {
          if (event.fileEventType === null) {
            return;
          }

          const timestamp = event.timestamp;

          if (lastRow.has("working")) {
            dataTable.setCell(lastRow.get("working"), 3, timestamp);
          }

          let durationName: string;
          switch (event.fileEventType) {
            case FileHashEvent.SELECTED:
              durationName = 'Queued, waiting for worker';
              break;
            case FileHashEvent.PICKED_UP:
              durationName = 'Transferring file to worker';
              if (event.file && filenames.indexOf(event.file) < navigator.hardwareConcurrency - 1) {
                durationName = 'Starting worker, ' + durationName;
              }
              break;
            case FileHashEvent.FILE_RECEIVED:
              durationName = 'Reading file';
              break;
            case FileHashEvent.FILE_READ:
              durationName = 'Computing hash';
              break;
            case FileHashEvent.HASH_COMPUTED:
              durationName = 'Returning hash result to main thread';
              break;
            case FileHashEvent.HASH_RECEIVED:
              durationName = 'Main thread received hash';
              break;
          }

          const row = dataTable.addRow(["working", durationName, timestamp, timestamp]);

          if (event.fileEventType === FileHashEvent.HASH_RECEIVED) {
            // lastRow.delete(event.file);
            lastRow.set("working", row);
            this.dataTable = dataTable;
            this.lastRow = lastRow;
          } else {
            lastRow.set("working", row);
          }

          chartOptions.height = filenames.length * 41 + 50;
          for (let i = 0; i< 50000; i++) {
            for (let j = 0; j < 50000; j++) {

            }
          }
          chart.draw(dataTable, chartOptions);
        }),
      );

      const realtimeUpdater$ = interval(0, animationFrameScheduler).pipe(
        tap(() => {
          const rowsToUpdate = Array.from(lastRow.values());

          for (const row of rowsToUpdate) {
            dataTable.setCell(row, 3, new Date());
          }

          if (rowsToUpdate.length) {
            const currentDateTime = new Date().valueOf();
            if (currentDateTime > chartOptions.hAxis.maxValue.valueOf() - 1000 * 2) {
              chartOptions.hAxis.maxValue = new Date(currentDateTime + 1000 * 20);
            }

            chart.draw(dataTable, chartOptions);
          }
        }),
      );

      return eventUpdates$.pipe(
        switchMapTo(realtimeUpdater$),
        takeUntil(
          this.complete$.pipe(
            filter(c => c),
            take(1),
            delay(0),
          ),
        ),
      );
    }),
  );
  lastRow: any;

  constructor(private googleChartService: GoogleChartsService) {}

  private *workPool(files: File[]): IterableIterator<File> {
    for (const file of files) {
      yield file;
      this.eventsPool$.next(this.logMessage(FileHashEvent.PICKED_UP, `file picked up for processing`, file.name));
    }
  }

  public hashMultipleFiles(files: File[]): Observable<HashWorkerMessage> {
    const queue: IterableIterator<File> = this.workPool(files);

    return fromWorkerPool<Blob, HashWorkerMessage>(index => {
      const worker = new Worker(new URL('../file-hash.worker', import.meta.url), {
        name: `hash-worker-${index}`,
        type: 'module',
      });
      this.eventsPool$.next(this.logMessage(null, `worker ${index} created`));
      return worker;
    }, queue).pipe(
      tap(res => {
        this.eventsPool$.next(res);
        if (res.fileEventType === FileHashEvent.HASH_COMPUTED) {
          this.eventsPool$.next({
            ...res,
            fileEventType: FileHashEvent.HASH_RECEIVED,
            timestamp: new Date(),
            message: 'hash received',
            thread: Thread.MAIN,
          });
          if(this.index < this.files.length) {
            const file = this.files[this.index];
            this.multiFilesToHash.next([file]);
            this.index++;
            this.eventsPool$.next(this.logMessage(FileHashEvent.SELECTED, 'file selected', file.name));
          }
        }
      }),
    );
  }

  public calculateMD5Multiple($event: Event): void {
    this.files =  Array.from(($event.target as HTMLInputElement).files || []);
    const file = this.files[this.index];
    this.multiFilesToHash.next([file]);
    this.index++
    this.eventsPool$.next(this.logMessage(FileHashEvent.SELECTED, 'file selected', file.name));
    // for (const file of files) {
    //   this.multiFilesToHash.next([file]);
    //   this.eventsPool$.next(this.logMessage(FileHashEvent.SELECTED, 'file selected', file.name));
    // }
  }

  private logMessage(eventType: FileHashEvent | null, message: string, file?: string): HashWorkerMessage {
    return { message, file, timestamp: new Date(), thread: Thread.MAIN, fileEventType: eventType };
  }
}
