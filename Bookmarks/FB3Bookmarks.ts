/// <reference path="FB3BookmarksHead.ts" />
/// <reference path="../plugins/moment.d.ts" />

module FB3Bookmarks {

  interface iWindow extends Window { ActiveXObject: any; }
  declare var window: iWindow;

	interface IXMLHTTPResponseCallback { (Data: XMLDocument): void }

	export class LitResBookmarksProcessor implements IBookmarks {
		public Ready: boolean;
		public Reader: FB3Reader.IFBReader;
		public Bookmarks: IBookmark[];
		public ClassPrefix: string;
		public LockID: string;
		public LoadDateTime: number;
		private LoadEndCallback: IBookmarksReadyCallback;
		private TemporaryNotes: IBookmarks;
		private WaitedToRemapBookmarks: number;
		private WaitForData: boolean;
		private XMLHttp: any;
		private Host: string;
		private SID: string;
		private Callback: any;
		private SaveAuto: boolean;
		private XMLHTTPResponseCallback: IXMLHTTPResponseCallback;
		constructor(public FB3DOM: FB3DOM.IFB3DOM, LitresSID?: string) {
			this.Ready = false;
			this.FB3DOM.Bookmarks.push(this);
			this.ClassPrefix = 'my_';
			this.Bookmarks = new Array();
			this.AddBookmark(new Bookmark(this));
			this.WaitForData = true;
			if (window.ActiveXObject) {
				this.XMLHttp = new window.ActiveXObject("Microsoft.XMLHTTP");
			} else {
				this.XMLHttp = new XMLHttpRequest();
			}
			this.Host = 'http://robot.litres.ru/'; // TODO: raplace
			this.SID = LitresSID;
			this.SaveAuto = false;
		}

		public AddBookmark(Bookmark: IBookmark): void {
			Bookmark.N = this.Bookmarks.length;
			this.Bookmarks.push(Bookmark);
		}
		public DropBookmark(Bookmark: IBookmark): void {
			for (var I = 0; I < this.Bookmarks.length; I++) {
				this.Bookmarks[I].N = I;
				if (this.Bookmarks[I] == Bookmark) {
					this.Bookmarks.splice(I, 1);
				}
			}
		}

		public Load(Callback?: IBookmarksReadyCallback) {
			this.LoadEndCallback = Callback;
			this.WaitForData = true;
			var URL = this.MakeLoadURL();
			this.XMLHTTPResponseCallback = this.AfterTransferFromServerComplete;
			this.SendNotesRequest(URL, 'GET');
			// todo some data transfer init stuff here, set AfterTransferFromServerComplete to run at the end
			// for now we just fire it as it is, should fire after XML loaded
			// setTimeout(()=>this.AfterTransferFromServerComplete(),200);
		}

		private AfterTransferFromServerComplete(XML: XMLDocument) {
			this.ParseXML(XML);
			this.WaitedToRemapBookmarks = 0;
			for (var I = 0; I < this.Bookmarks.length; I++) {
				if (!this.Bookmarks[I].XPathMappingReady) {
					this.Bookmarks[I].RemapWithDOM(() => this.OnChildBookmarkSync());
					this.WaitedToRemapBookmarks++;
				}
			}
			if (!this.WaitedToRemapBookmarks) {
				this.WaitForData = false;
				this.LoadEndCallback(this);
			}
		}

		private OnChildBookmarkSync() {
			this.WaitedToRemapBookmarks--;
			if (!this.WaitedToRemapBookmarks) {
				this.WaitForData = false;
				this.LoadEndCallback(this);
			}
		}

		private ParseXML(XML: XMLDocument) {
			// todo some xml-parsing upon data receive here to make pretty JS-bookmarks from ugly XML
			var Rows = XML.querySelectorAll('Selection');
			this.LoadDateTime = moment().unix();
			if (XML.documentElement.getAttribute('lock-id')) {
				this.LockID = XML.documentElement.getAttribute('lock-id');
			}
			if (Rows.length) {
				// console.log('we have selection');
				for (var j = 0; j < Rows.length; j++) {
					var NewBookmark = new Bookmark(this);
					NewBookmark.ParseXML(Rows[j]);
					if (NewBookmark.Group == 0) { // TODO: skip for temporary Obj
						this.Bookmarks[0] = NewBookmark;
					} else {
						this.AddBookmark(NewBookmark);
					}
				}
			} else {
				// console.log('we dont have any selections on server');
			}
		}

		public Store(): void { // TODO: fill it
			this.ReLoad(true);
		}

		private StoreBookmarks(): void {
			var XML = this.MakeStoreXML();
			var Data = this.MakeStoreData(XML);
			var URL = this.MakeStoreURL();
			this.XMLHTTPResponseCallback = () => {
				this.Reader.Site.canStoreBookmark = true;
			};
			this.SendNotesRequest(URL, 'POST', Data);
		}

		public ApplyPosition(): boolean {
			// If DOM.TOC not ready yet, we can't expand XPath for any way - we wait while Reader.LoadDone fire this
			if (!this.FB3DOM.Ready || this.WaitForData) {
				return false;
			}
			this.Ready = true;
			this.Reader.GoTO(this.Bookmarks[0].Range.From.slice(0));
			return true;
		}

		public ReLoad(SaveAutoState?: boolean) {
			var TemporaryNotes = new LitResBookmarksProcessor(this.FB3DOM, this.SID);
			TemporaryNotes.Reader = this.Reader;
			TemporaryNotes.Bookmarks[0].Group = -1;
			this.SaveAuto = SaveAutoState;
			TemporaryNotes.SaveAuto = this.SaveAuto;
			TemporaryNotes.Load((Bookmarks: IBookmarks) => this.ReLoadComplete(Bookmarks));
		}
		private ReLoadComplete(TemporaryNotes: IBookmarks): void {
			// merge data from TemporaryNotes to this, then dispose of temporary LitResBookmarksProcessor
			// than check if new "current position" is newer, if so - goto it
			// keep in mind this.Bookmarks[0] is always here and is the current position,
			// so we skip it on merge
			var AnyUpdates = false;
			if (this.Bookmarks.length) {
				var Found;
				for (var i = 1; i < this.Bookmarks.length; i++) { // delete old local bookmarks
					for (var j = 1; j < TemporaryNotes.Bookmarks.length; j++) {
						if (this.Bookmarks[i].ID == TemporaryNotes.Bookmarks[j].ID) {
							Found = 1;
							break;
						}
					}
					if (!Found && !this.Bookmarks[i].NotSavedYet) {
						this.Bookmarks[i].Detach();
						AnyUpdates = true;
					}
				}
				Found = 0;
				for (var j = 1; j < TemporaryNotes.Bookmarks.length; j++) { // check new bookmarks
					Found = 0;
					for (var i = 1; i < this.Bookmarks.length; i++) {
						if (this.Bookmarks[i].ID == TemporaryNotes.Bookmarks[j].ID) {
							if (this.Bookmarks[i].DateTime < TemporaryNotes.Bookmarks[j].DateTime) {
								this.Bookmarks[i].Detach();
							} else {
								Found = 1;
							}
							break;
						} else if (TemporaryNotes.Bookmarks[j].DateTime < this.LoadDateTime) {
							Found = 1;
						}
					}
					if (!Found && TemporaryNotes.Bookmarks[j].Group >= 0) {
						AnyUpdates = true;
						this.AddBookmark(TemporaryNotes.Bookmarks[j]);
					}
				}
			} else {
				this.Bookmarks = TemporaryNotes.Bookmarks;
				if (this.Bookmarks.length) {
					AnyUpdates = true;
				}
			}
			this.Reader.Site.canStoreBookmark = false;
			if (!TemporaryNotes.Bookmarks[0].NotSavedYet &&
				this.Bookmarks[0].DateTime < TemporaryNotes.Bookmarks[0].DateTime) {
					// Newer position from server
					this.Reader.GoTO(TemporaryNotes.Bookmarks[0].Range.From);
			} else if (AnyUpdates) {
				// Updated bookmarks data from server - we should redraw the page in case there are new notes
				this.Reader.Redraw();
			}
			if (this.SaveAuto) {
				this.LockID = TemporaryNotes.LockID;
				this.LoadDateTime = TemporaryNotes.LoadDateTime;
				this.StoreBookmarks();
			}
		}

		private MakeLoadURL(): string {
			var URL = this.Host + 'pages/catalit_load_bookmarks/?uuid=' + this.Reader.ArtID +
				(this.SaveAuto ? '&set_lock=1' : '') + '&sid=' + this.SID + '&r=' + Math.random();
			return URL;
		}
		private MakeStoreURL(): string {
			return this.Host + 'pages/catalit_store_bookmarks/';
		}
		private MakeStoreData(XML: string): string {
			var Data = 'uuid=' + this.FB3DOM.MetaData.UUID + '&data=' + encodeURIComponent(XML) +
				'&lock_id=' + encodeURIComponent(this.LockID) + '&sid=' + this.SID + '&r=' + Math.random();
			return Data;
		}

		private MakeStoreXML(): string {
			var XML = '<FictionBookMarkup xmlns="http://www.gribuser.ru/xml/fictionbook/2.0/markup" ' +
				'xmlns:fb="http://www.gribuser.ru/xml/fictionbook/2.0" lock-id="' + this.LockID + '">';
			this.Bookmarks[0].XStart = this.FB3DOM.GetXPathFromPos(this.Bookmarks[0].Range.From);
			this.Bookmarks[0].XEnd = this.Bookmarks[0].XStart;
			for (var j = 0; j < this.Bookmarks.length; j++) {
				XML += this.Bookmarks[j].PublicXML();
			}
			XML += '</FictionBookMarkup>';
			return XML;
		}

		private SendNotesRequest(URL: string, Type: string, Data?: string): void {
			var Data = Data || null;
			this.XMLHttp.onreadystatechange = () => this.XMLHTTPResponse();
			this.XMLHttp.open(Type, URL, true);
			this.XMLHttp.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
			this.XMLHttp.send(Data);
		}
		private XMLHTTPResponse(): void {
			if (this.XMLHttp.readyState == 4 && this.XMLHttp.status == 200) {
				this.XMLHTTPResponseCallback(this.XMLHttp.responseXML);
			}
			// TODO: add error handler
		}

		public CheckBookmarksOnPage(): boolean {
			if (this.Bookmarks.length <= 1) return false;
			var CurrentPage = this.Reader.GetCurrentVisiblePage();
			var X = CurrentPage.RenderInstr.Range.From;
			var Y = CurrentPage.RenderInstr.Range.To;
			for (var j = 1; j < this.Bookmarks.length; j++) {
				if (this.Bookmarks[j].Group == 1) {
					var xps = FB3DOM.XPathCompare(this.Bookmarks[j].XStart, X);
					var xpe = FB3DOM.XPathCompare(this.Bookmarks[j].XEnd, Y);
					console.log(xps);
					console.log(xpe);
					if (xps <= 0 || xpe >= 0) {
						return true;
					}
				}
			}
			return false;
		}
	}

	export class Bookmark implements IBookmark {
		public ID: string;
		public Range: FB3DOM.IRange;
		public XStart: IXPath;
		public XEnd: IXPath;
		public Group: number;
		public Class: string;
		public Title: string;
		public Note: InnerFB2;
		public RawText: string;
		public XPathMappingReady: boolean;
		public N: number;
		public DateTime: number;
		public NotSavedYet: number;
		private RequiredChunks: number[];
		private AfterRemapCallback: IBookmarkSyncCallback;
		constructor(private Owner: IBookmarks) {
			this.ID = this.MakeSelectionID();
			this.Group = 0;
			this.Class = 'default';
			this.Range = { From: [0], To: [0] };
			this.XStart = [0];
			this.XEnd = [0];
			this.XPathMappingReady = true;
			this.N = -1;
			this.DateTime = moment().unix();
			this.NotSavedYet = 1;
		}

		public InitFromXY(X: number, Y: number): boolean {
			return this.InitFromPosition(this.Owner.Reader.ElementAtXY(X, Y));
		}

		public InitFromXPath(XPath: IXPath): boolean {
			return this.InitFromPosition(this.Owner.FB3DOM.GetAddrByXPath(XPath));
		}

		public InitFromPosition(Position: FB3Reader.IPosition): boolean {
			if (Position) {
				this.Range.From = Position.slice(0);
				this.Range.To = Position;
				this.GetDataFromText();
				return true;
			} else {
				return undefined;
			}
		}

		public ExtendToXY(X: number, Y: number): boolean {
			var BaseTo = this.Owner.Reader.ElementAtXY(X, Y);
			if (BaseTo && BaseTo.length > 1) {
				this.Range.To = BaseTo;
				this.GetDataFromText();
				return true;
			} else {
				return undefined;
			}
		}

		public RoundClone(ToBlock: boolean): IBookmark {
			var Clone = new Bookmark(this.Owner);

			Clone.Range = FB3Reader.RangeClone(this.Range);

			if (ToBlock) {
				this.RoundToBlockLVLUp(Clone.Range.From);
				this.RoundToBlockLVLDn(Clone.Range.To);
			} else {
				this.RoundToWordLVLUp(Clone.Range.From);
				this.RoundToWordLVLDn(Clone.Range.To);
			}

			Clone.GetDataFromText();
			Clone.Group = this.Group;
			Clone.Class = this.Class;

			return Clone;
		}

		public Detach() {
			this.Owner.DropBookmark(this);
			// this.Owner.Store();
		}

		private RoundToWordLVLDn(Adress: FB3Reader.IPosition) {
			var Block = this.Owner.FB3DOM.GetElementByAddr(Adress.slice(0));
			var PosInBlock = Adress[Adress.length - 1];
			while (Block.Parent && (!Block.TagName || !Block.TagName.match(FB3DOM.BlockLVLRegexp))) {
				Block = Block.Parent;
				PosInBlock = Adress[Adress.length - 1];
				Adress.pop();
			}
			while (PosInBlock < Block.Childs.length - 1 && !Block.Childs[PosInBlock].Childs && !Block.Childs[PosInBlock].text.match(/\s$/)) {
				PosInBlock++;
			}
			Adress.push(PosInBlock);
		}
		private RoundToWordLVLUp(Adress: FB3Reader.IPosition) {
			var Block = this.Owner.FB3DOM.GetElementByAddr(Adress.slice(0));
			var PosInBlock = Adress[Adress.length - 1];
			while (Block.Parent && (!Block.TagName || !Block.TagName.match(FB3DOM.BlockLVLRegexp))) {
				Block = Block.Parent;
				PosInBlock = Adress[Adress.length - 1];
				Adress.pop();
			}
			if (PosInBlock < Block.Childs.length - 2) {
				PosInBlock++;
			}
			while (PosInBlock > 0 && !Block.Childs[PosInBlock-1].Childs && !Block.Childs[PosInBlock-1].text.match(/\s$/)) {
				PosInBlock--;
			}
			Adress.push(PosInBlock);
		}

		private RoundToBlockLVLUp(Adress: FB3Reader.IPosition) {
			var Block = this.Owner.FB3DOM.GetElementByAddr(Adress.slice(0));
			while (Block.Parent && (!Block.TagName || !Block.TagName.match(FB3DOM.BlockLVLRegexp))) {
				Block = Block.Parent;
				Adress.pop();
			}
		}
		private RoundToBlockLVLDn(Adress: FB3Reader.IPosition) {
			this.RoundToBlockLVLUp(Adress);
			var Block = this.Owner.FB3DOM.GetElementByAddr(Adress.slice(0));
			if (Block.TagName && Block.TagName.match(FB3DOM.BlockLVLRegexp)) {
				return;
			}
			if (Block.Parent.Childs.length > Block.ID + 1) {
				Adress[Adress.length - 1]++;
			} else {
				Adress.push(Block.Childs.length);
			}
		}

		public ClassName(): string {
			return this.Owner.ClassPrefix + 'selec_' + this.Group + '_' + this.Class + ' ' + this.Owner.ClassPrefix + 'selectid_' + this.N;
		}

		private GetDataFromText() {
			var PageData = new FB3DOM.PageContainer();
			this.Owner.FB3DOM.GetHTML(this.Owner.Reader.HyphON, this.Owner.Reader.BookStyleNotes, FB3Reader.RangeClone(this.Range), '', 100, 100, PageData);
			// We first remove unknown characters
			var InnerHTML = PageData.Body.join('').replace(/<(?!\/?p\b|\/?strong\b|\/?em\b)[^>]*>/, '');
			// Then we extract plain text
			this.Title = InnerHTML.replace(/<[^>]+>|\u00AD/gi, '').substr(0, 50).replace(/\s+\S*$/, '');
			this.RawText = InnerHTML.replace(/(\s\n\r)+/gi, ' ');
			this.RawText = this.RawText.replace(/<(\/)?strong[^>]*>/gi, '[$1b]');
			this.RawText = this.RawText.replace(/<(\/)?em[^>]*>/gi, '[$1i]');
			this.RawText = this.RawText.replace(/<\/p>/gi, '\n');
			this.RawText = this.RawText.replace(/<\/?[^>]+>|\u00AD/gi, '');
			this.RawText = this.RawText.replace(/^\s+|\s+$/gi, '');
			this.Note = this.Raw2FB2(this.RawText);
			// todo - should fill this.Extract with something equal|close to raw fb2 fragment
			this.XStart = this.Owner.FB3DOM.GetXPathFromPos(this.Range.From.slice(0));
			this.XEnd = this.Owner.FB3DOM.GetXPathFromPos(this.Range.To.slice(0));
		}

		private Raw2FB2(RawText: string): string {
			RawText = RawText.replace(/\[(\/)?b[^\]]*\]/gi, '<$1strong>');
			RawText = RawText.replace(/\[(\/)?i[^\]]*\]/gi, '<$1emphasis>');
			RawText = '<p>' + RawText.replace(/\n/gi, '</p><p>') + '</p>';
			return RawText;
		}
		private MakeSelectionID(): string {
			var MakeSelectionIDSub = function (chars, len) {
				var text = '';
				for (var i = 0; i < len; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
				return text;
			}
			var text = '',
				chars = 'ABCDEFabcdef0123456789';
			text += MakeSelectionIDSub(chars, 8) + '-';
			text += MakeSelectionIDSub(chars, 4) + '-';
			text += MakeSelectionIDSub(chars, 4) + '-';
			text += MakeSelectionIDSub(chars, 4) + '-';
			text += MakeSelectionIDSub(chars, 12);
			return text;
		}

		public RemapWithDOM(Callback: IBookmarkSyncCallback): void {
			this.AfterRemapCallback = Callback;
			this.InitSyncXPathWithDOM();
		}

		private InitSyncXPathWithDOM(): void {
			this.XPathMappingReady = false;
			if (!this.Owner.FB3DOM.DataChunks) { // No info on chunks yet, keep waiting
				setTimeout(() => this.InitSyncXPathWithDOM(), 10);
				return;
			}
			this.RequiredChunks = this.ChunksRequired();
			var ChunksToLoad = new Array();

			// First we check, if some of required chunks are not set to be loaded yet
			for (var I = 0; I < this.RequiredChunks.length; I++) {
				if (!this.Owner.FB3DOM.DataChunks[this.RequiredChunks[I]].loaded) {
					ChunksToLoad.push(this.RequiredChunks[I]);
				}
			}
			// If there are missing chunks - we initiate loading for them
			if (ChunksToLoad.length) {
				this.Owner.FB3DOM.LoadChunks(ChunksToLoad, () => this.DoSyncXPathWithDOM());
			} else {
				this.DoSyncXPathWithDOM();
			}
		}

		private DoSyncXPathWithDOM(): void {
			for (var I = 0; I < this.RequiredChunks.length; I++) {
				if (this.Owner.FB3DOM.DataChunks[this.RequiredChunks[I]].loaded != 2) {
					// There is at least one chunk still being loaded - we will return later
					setTimeout(() => this.DoSyncXPathWithDOM(), 10);
					return;
				}
			}

			// Ok, all chunks are here, now we need to map fb2 xpath to internal xpath
			this.Range = {
				From: this.Owner.FB3DOM.GetAddrByXPath(this.XStart),
				To: this.Owner.FB3DOM.GetAddrByXPath(this.XEnd)
			};
			this.XPathMappingReady = true;
			if (this.AfterRemapCallback) {
				this.AfterRemapCallback();
				this.AfterRemapCallback = undefined;
			}
		}

		private ChunksRequired(): number[]{
			var Result = new Array();
			var StartChunk = this.XPChunk(this.XStart);
			var EndChunk = this.XPChunk(this.XEnd);
			if (StartChunk === undefined) {
				StartChunk = EndChunk;
			}
			if (StartChunk !== undefined) {
				Result[0] = StartChunk;
				if (EndChunk != Result[0]) {
					Result.push(EndChunk);
				}
			}
			return Result;
		}

		private XPChunk(X: IXPath): number {
			for (var I = 0; I < this.Owner.FB3DOM.DataChunks.length; I++) {
				var xps = FB3DOM.XPathCompare(X, this.Owner.FB3DOM.DataChunks[I].xps);
				var xpe = FB3DOM.XPathCompare(X, this.Owner.FB3DOM.DataChunks[I].xpe);
				if (!xps || !xpe || xps > 0 && xpe < 10) {
					return I;
				}
			}
			return undefined; // In case we have out-of-field pointer - define it implicitly
		}

		public PublicXML(): string {
			return '<Selection group="' + this.Group + '" ' +
				(this.Class ? 'class="' + this.Class + '" ' : '') +
				(this.Title ? 'title="' + this.Title + '" ' : '') +
				'id="' + this.ID + '" ' +
				'selection="fb2#xpointer(' + this.MakeSelection() + ')" ' +
				'art-id="' + this.Owner.FB3DOM.MetaData.UUID + '" ' +
				'last-update="' + moment().format("YYYY-MM-DDTHH:mm:ssZ") + '">' +
				this.GetNote() + this.Extract() +
			'</Selection>';
		}

		public ParseXML(XML: any): void { // TODO: fix, need correct type
			this.Group = parseInt(XML.getAttribute('group'));
			this.Class = XML.getAttribute('class');
			this.Title = XML.getAttribute('title');
			this.ID = XML.getAttribute('id');
			this.MakeXPath(XML.getAttribute('selection'));
			this.DateTime = moment(XML.getAttribute('last-update'), "YYYY-MM-DDTHH:mm:ssZ").unix();
			if (XML.querySelector('Note')) {
				this.Note = XML.querySelector('Note').innerHTML.replace(/<p\s[^>]+>/, '<p>');
			}
			this.NotSavedYet = 0;
			this.XPathMappingReady = false;
			// TODO: fill and check
//			this.RawText = '';
//			this.Range;
		}

		private GetNote(): string {
			if (!this.Note) return '';
			return '<Note>' + this.Note + '</Note>';
		}

		private Extract(): string {
			return '<Extract original-location="fb2#xpointer(' + this.MakeExtractSelection() + ')">' +
				this.ExtractNode() + '</Extract>';
		}
		private ExtractNode(): string {
			// TODO: fill with code
			return '<p>or 4 test text</p>';
		}
		private MakeExtractSelection(): string {
			var Start: string = this.MakePointer(this.XStart);
			return '/1/' + Start.replace(/\.\d+$/, '') + '';
		}

		private MakeSelection(): string {
			var Start: string = this.MakePointer(this.XStart);
			if (FB3DOM.XPathCompare(this.XStart, this.XEnd) == 0)
				return 'point(/1/' + Start + ')';
			return 'point(/1/' + Start + ')/range-to(point(/1/' + this.MakePointer(this.XEnd) + '))';
		}

		private MakePointer(X: IXPath): string {
			var last = X.pop() + '';
			return X.join('/') + ((/^\./).test(last) ? '' : '/') + last + ((/^\./).test(last) ? '' : '.0');
		}

		private MakeXPath(X: string): void {
			var p = X.match(/\/1\/(.[^\)]*)/g);
			var MakeXPathSub = function (str) {
				return str.replace(/^\/1\//, '').replace(/\.0$/, '').replace('.', '/.').split('/');
			}
			this.XStart = MakeXPathSub(p[0]);
			if (p.length == 1) {
				this.XEnd = this.XStart;
			} else {
				this.XEnd = MakeXPathSub(p[1]);
			}
		}

	}}