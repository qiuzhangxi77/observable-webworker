import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { SingleWorkerComponent } from './single-worker/single-worker.component';
import { MultipleWorkerPoolComponent } from './multiple-worker-pool/multiple-worker-pool.component';
import { LogLineComponent } from './multiple-worker-pool/log-line/log-line.component';
import { SingleWorkerMultipleTaskComponent } from "./single-worker-multiple-task/single-worker-multiple-task.component";

@NgModule({
    declarations: [AppComponent, SingleWorkerComponent, MultipleWorkerPoolComponent, LogLineComponent, SingleWorkerMultipleTaskComponent],
    providers: [],
    bootstrap: [AppComponent],
    imports: [BrowserModule]
})
export class AppModule {}
