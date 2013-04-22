/// <reference path="FB3ReaderAllModules.ts" />

module FB3Reader {

	export class FB3Reader implements IFBReader {
		private FB3DOM: FB3DOM.IFB3DOM;
		public Progress: FB3ReaderSite.ILoadProgress;
		public alert: FB3ReaderSite.IAlert;
		public NotePopup: FB3ReaderSite.INotePopup;

		constructor(URL: string, Site: FB3ReaderSite.IFB3ReaderSite) {
			this.FB3DOM = new FB3DOM.FB3DOM(URL, this.Progress);
		}
		GoTO(Bloc: FB3DOM.IPointer) {
		}
	}

}