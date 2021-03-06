/// <reference path="../FB3ReaderHeaders.ts" />

module FB3Bookmarks {

	export interface IXPath extends Array<any> { }
	export interface InnerFB2 extends String {}

	export interface IBookmarksReadyCallback { (Bookmarks: IBookmarks): void; }
	export interface IBookmarkSyncCallback { (): void; }

	export interface IBookmark {
		ID: string;
		N: number;			// Represents IBookmarks.Bookmarks[N] position
		DateTime: number; // unix timestamp
		NotSavedYet: number; // Attr for just created Note
		Range: FB3DOM.IRange;
		XStart: IXPath; // xpath for start point
		XEnd: IXPath;		// xpath for end point
		Group: number;
		Class?: string;
		Title?: string;
		Note?: InnerFB2;
		RawText: string;
		XPathMappingReady: boolean; // For server-loaded bookmarks, used to watch fb2xpath -> internal xpath mapping progress
		ClassName(): string;		// css class name for selections of this type
		InitFromXY(X: number, Y: number): boolean;
		InitFromXPath(XPath: IXPath): boolean;
		InitFromPosition(Position: FB3Reader.IPosition): boolean;
		ExtendToXY(X: number, Y: number): boolean;
		RoundClone(ToBlock: boolean): IBookmark;// clones itself and expand range to capture block-level elements
		Detach(): void; // removes itself from the parent.
		RemapWithDOM(Callback: IBookmarkSyncCallback): void;
		PublicXML(): string;
		ParseXML(XML: any): void;
	}

	export interface IBookmarks {
		Ready: boolean;
		LockID?: string;
		LoadDateTime: number;
		FB3DOM: FB3DOM.IFB3DOM;
		Reader: FB3Reader.IFBReader;
		Bookmarks: IBookmark[];
		ClassPrefix: string;
		AddBookmark(Bookmark: IBookmark): void;
		DropBookmark(Bookmark: IBookmark): void;
		Load(Callback?: IBookmarksReadyCallback);   // Loads bookmarks from the server
		ReLoad();	// Updates itself from the server (may get new current position)
		ApplyPosition(): boolean;
		Store(): void;
		CheckBookmarksOnPage(): boolean;
	}

}