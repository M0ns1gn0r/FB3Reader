/// <reference path="FB3ReaderHead.ts" />
/// <reference path="FB3Reader.ts" />

module FB3ReaderPage {
	interface ElementDesc {
		Node: HTMLDivElement;
		Width: number;
		Height: number;
		MarginTop: number;
		MarginBottom: number;
		MarginLeft: number;
		MarginRight: number;
	}
	interface IFallOut {
		FallOut: FB3Reader.IPosition; // Agress of the first element to not fit the page
		Height: number;								// Height of the page we've examined
		NotesHeight: number;					// Height for the notes block
		FalloutElementN: number;			// Last root element to fully fit the page - skipped during future lookup
		EndReached: boolean;					// False if there were not enough text to fill the page
	}

	function HardcoreParseInt(Input: string): number {
		Input.replace(/\D/g, '');
		if (Input == '')
			Input = '0';
		return parseInt(Input);
	}

	function PageBreakBefore(Node: HTMLElement): boolean {
		return Node.nodeName.toLowerCase().match(/^h[1-3]/) ? true : false;
	}
	function PageBreakAfter(Node: HTMLElement): boolean {
		return false; // todo
	}

	function IsNodeUnbreakable(Node: HTMLElement): boolean {

		if (Node.nodeName.match(/^(h\d|a)$/i)) {
			return true;
		}

		if (Node.className.match(/\btag_nobr\b/)) {
			return true;
		}

		var Chld1 = Node.children[0];
		if (Chld1) {
			if (Chld1.nodeName.match(/^h\d$/i)) {
				return true;
			}
		}
		return false;
	}

	export class ReaderPage {
		private Element: ElementDesc;
		private ParentElement: HTMLDivElement;
		private NotesElement: ElementDesc;
		private RenderMoreTimeout: number;
		private Site: FB3ReaderSite.IFB3ReaderSite;
		private Visible: boolean;
		private Width: number;
		public ViewPortW: number;
		public ViewPortH: number;
		public RenderInstr: FB3Reader.IPageRenderInstruction;
		public PagesToRender: FB3Reader.IPageRenderInstruction[];
		public ID: number;
		public Next: ReaderPage; // If null - it's not a page but prerender container
		public Ready: boolean;
		public Reseted: boolean;
		public PrerenderBlocks: number;
		public PageN: number;
		public Pending: boolean;

		constructor(public ColumnN: number,
			private FB3DOM: FB3DOM.IFB3DOM,
			private FBReader: FB3Reader.Reader,
			Prev: ReaderPage) {
			this.Reseted = false;
			if (Prev) {
				Prev.Next = this;
			}
			this.PrerenderBlocks = 4;
			this.Ready = false;
			this.Pending = false;
		}

		Show(): void {
			if (!this.Visible) {
				this.ParentElement.style.top = '0';
				this.Visible = true;
			}
		}

		Hide(): void {
			// It's breaking apart here somehow :(
			//			return;
			if (this.Visible) {
				this.ParentElement.style.top = '100000px';
				this.Visible = false;
			}
		}

		GetInitHTML(ID: number): FB3DOM.InnerHTML {
			this.ID = ID;
			return '<div class="FB2readerCell' + this.ColumnN + 'of' + this.FBReader.NColumns +
				' FB2readerPage"><div class="FBReaderContentDiv" id="FB3ReaderColumn' + this.ID +
				'">...</div><div class="FBReaderNotesDiv" id="FB3ReaderNotes' + this.ID + '">...</div></div>';
		}

		private FillElementData(ID: string): ElementDesc {
			var Element = <HTMLDivElement> this.Site.getElementById(ID);
			var Width = Element.offsetWidth;
			var Height = Element.parentElement.offsetHeight;
			var MarginTop; var MarginBottom;
			var MarginLeft; var MarginRight;
			if (document.all) {// IE
				MarginTop = HardcoreParseInt(Element.currentStyle.marginTop)
				+ HardcoreParseInt(Element.currentStyle.paddingTop);
				MarginBottom = HardcoreParseInt(Element.currentStyle.marginBottom)
				+ HardcoreParseInt(Element.currentStyle.paddingBottom);
				MarginLeft = HardcoreParseInt(Element.currentStyle.marginTop)
				+ HardcoreParseInt(Element.currentStyle.paddingLeft);
				MarginRight = HardcoreParseInt(Element.currentStyle.marginRight)
				+ HardcoreParseInt(Element.currentStyle.paddingRight);
			} else {// Mozilla
				MarginTop = parseInt(getComputedStyle(Element, '').getPropertyValue('margin-top'))
				+ parseInt(getComputedStyle(Element, '').getPropertyValue('padding-top'));
				MarginBottom = parseInt(getComputedStyle(Element, '').getPropertyValue('margin-bottom'))
				+ parseInt(getComputedStyle(Element, '').getPropertyValue('padding-bottom'));
				MarginLeft = parseInt(getComputedStyle(Element, '').getPropertyValue('margin-left'))
				+ parseInt(getComputedStyle(Element, '').getPropertyValue('padding-left'));
				MarginRight = parseInt(getComputedStyle(Element, '').getPropertyValue('margin-right'))
				+ parseInt(getComputedStyle(Element, '').getPropertyValue('padding-right'));
			}
			return {
				Node: Element,
				Width: Width,
				Height: Height,
				MarginTop: MarginTop,
				MarginBottom: MarginBottom,
				MarginLeft: MarginLeft,
				MarginRight: MarginRight
			};
		}
		BindToHTMLDoc(Site: FB3ReaderSite.IFB3ReaderSite): void {
			this.Site = Site;
			this.Element = this.FillElementData('FB3ReaderColumn' + this.ID);
			this.NotesElement = this.FillElementData('FB3ReaderNotes' + this.ID);
			this.ParentElement = <HTMLDivElement> this.Element.Node.parentElement;
			this.Visible = false;
			this.Width = Math.floor(this.Site.Canvas.scrollWidth / this.FBReader.NColumns);
			this.ViewPortH = this.ParentElement.scrollHeight - this.Element.MarginTop - this.Element.MarginBottom;
			this.ViewPortW = this.Element.Width - this.Element.MarginLeft - this.Element.MarginRight;
			this.ParentElement.style.width = this.Width + 'px';
			this.ParentElement.style.position = 'absolute';
			this.ParentElement.style.left = (this.Width * this.ColumnN) + 'px';
			this.ParentElement.style.top = '-100000px';
		}

		SetPending(PagesToRender: FB3Reader.IPageRenderInstruction[]): void {
			var PageToPend = this;
			for (var I = 0; I < PagesToRender.length; I++) {
				PageToPend.Pending = true;
				PageToPend = PageToPend.Next;
			}
		}

		DrawInit(PagesToRender: FB3Reader.IPageRenderInstruction[]): void {
			//			console.log('DrawInit '+this.ID);
			if (PagesToRender.length == 0) return;
			if (this.Reseted) {
				this.Reseted = false;
				return;
			}
			this.Ready = false;
			this.Pending = true;

			this.RenderInstr = PagesToRender.shift();
			this.PagesToRender = PagesToRender;

			var Range: FB3DOM.IRange;
			if (this.RenderInstr.Range) { // Exact fragment (must be a cache?)
				Range = {
					From: this.RenderInstr.Range.From.slice(0),
					To: this.RenderInstr.Range.To.slice(0)
				};
				//  As we host hyphen in the NEXT element(damn webkit) and a hyphen has it's width,
				//  we always need to have one more inline - element to make sure the element without
				//  a hyphen(and thus enormously narrow) will not be left on the page as a last element,
				//  while it should fall down being too wide with hyphen attached Like this:
				//  Wrong:                                            Right:
				//  |aaa bb-|                                         |aaa bb-|
				//  |bb cccc|                                         |bb cccc|
				//  |d eeeee|<if page cut here - error>               |d  eee-| << this hyphen fits ok, next will not
				//  |-ee    |<< this hyphen must be the               |eeee   | << this tail bring excess part down
				//              6-th char, so "eeeee" would NOT fit
				if (Range.To[Range.To.length - 1]) {
					Range.To[Range.To.length - 1]++;
				} else {
					//while (Addr.length && Addr[Addr.length - 1] == 0) {
					//	Addr.pop();
					//	Addr[Addr.length - 1]--;
					//}
				}
			} else {
				if (!this.RenderInstr.Start) { // It's fake instruction. We consider in as "Render from start" request
					this.RenderInstr.Start = [0];
				} // Start point defined

				Range = this.DefaultRangeApply(this.RenderInstr);
			}

			this.FB3DOM.GetHTMLAsync(this.FBReader.HyphON,
				this.FBReader.BookStyleNotes,
				FB3Reader.RangeClone(Range),
				this.ID + '_',
				this.ViewPortW,
				this.ViewPortH,
				(PageData: FB3DOM.IPageContainer) => this.DrawEnd(PageData));
		}

		// Take a poind and add PrerenderBlocks of blocks to it
		DefaultRangeApply(RenderInstr: FB3Reader.IPageRenderInstruction) {
			var FragmentEnd = RenderInstr.Start[0] * 1 + this.PrerenderBlocks;
			if (FragmentEnd > this.FB3DOM.TOC[this.FB3DOM.TOC.length - 1].e) {
				FragmentEnd = this.FB3DOM.TOC[this.FB3DOM.TOC.length - 1].e;
			}
			return { From: RenderInstr.Start.slice(0), To: [FragmentEnd] };
		}

		CleanPage() {
			this.NotesElement.Node.innerHTML = this.Element.Node.innerHTML = '';
			this.PageN = undefined;
			this.Ready = true;
			this.Pending = false;
		}

		DrawEnd(PageData: FB3DOM.IPageContainer) {
			//			console.log('DrawEnd ' + this.ID);
			if (this.Reseted) {
				this.Reseted = false;
				return;
			}
			this.Element.Node.innerHTML = PageData.Body.join('');
			if (PageData.FootNotes.length && this.FBReader.BookStyleNotes) {
				this.NotesElement.Node.innerHTML = PageData.FootNotes.join('');
				this.NotesElement.Node.style.display = 'block';
			}
			//			this.NotesElement.Node.style.display = PageData.FootNotes.length ? 'block' : 'none';
			if (!this.RenderInstr.Range) {
				var FallOut = this.FallOut(this.Element.Height - this.Element.MarginTop - this.Element.MarginBottom, 0);

				if (FB3Reader.PosCompare(FallOut.FallOut, this.RenderInstr.Start) == 0) {
					// It's too bad baby: text does not fit the page, not even a char
					// Let's try to stripe book-style footnotes first (if they are ON) - this must clean up some space
					if (this.FBReader.BookStyleNotes && PageData.FootNotes.length) {
						this.FBReader.BookStyleNotes = false;
						this.FBReader.BookStyleNotesTemporaryOff = true;
						this.RenderInstr.Range = null;
						this.NotesElement.Node.innerHTML = '';
						this.DrawInit([this.RenderInstr].concat(this.PagesToRender));
						return;
					} else {
						// That's it - no way to recover. We die now, later we will make some fix here
						this.FBReader.Site.Alert('We can not fit the text into the page!');
						this.RenderInstr.Start = [this.RenderInstr.Start[0] + 1];
						this.RenderInstr.Range = null;
						if (this.FBReader.BookStyleNotesTemporaryOff) {
							this.FBReader.BookStyleNotes = true;
							this.FBReader.BookStyleNotesTemporaryOff = false;
						}
						this.DrawInit([this.RenderInstr].concat(this.PagesToRender));
						return;
					}
				}

				var PageCorrupt = false;
				if (this.FBReader.BookStyleNotesTemporaryOff) {
					this.FBReader.BookStyleNotes = true;
					this.FBReader.BookStyleNotesTemporaryOff = false;
					PageCorrupt = true;
				}

				// We can have not enough content to fill the page. Sometimes we will refill it,
				// but sometimes (doc end or we only 
				if (!FallOut.EndReached) {
					if (this.FB3DOM.TOC[this.FB3DOM.TOC.length - 1].e > FallOut.FallOut[0]) {
						// Ups, our page is incomplete - have to retry filling it. Take more data now
						//var BasePrerender = this.PrerenderBlocks;
						this.PrerenderBlocks += 2;
						this.RenderInstr.Range = null;
						this.DrawInit([this.RenderInstr].concat(this.PagesToRender));
						//this.PrerenderBlocks = BasePrerender;
						return;
					} else if (this.Next) { // Unless this is prerender frrame, otherwase no need to bother
						var NP = this;
						for (var I = 0; I < this.PagesToRender.length; I++) {
							NP = NP.Next;
							NP.CleanPage();
							NP.Ready = false;
							NP.RenderInstr.Range = { From: [-1], To: [-1] };
						}
					}
					this.PagesToRender = [];
					this.RenderInstr.Range = {
						From: this.RenderInstr.Start.splice(0),
						To: FallOut.FallOut
					};
					this.RenderInstr.Range.To[0]++;
				} else {
					this.RenderInstr.Range = {
						From: this.RenderInstr.Start.splice(0),
						To: FallOut.FallOut
					};
				}
				this.RenderInstr.Height = FallOut.Height;
				this.RenderInstr.NotesHeight = FallOut.NotesHeight;


				this.PageN = this.RenderInstr.CacheAs;
				if (this.PageN !== undefined) {
					this.FBReader.StoreCachedPage(this.RenderInstr);
				}

				// Ok, we have rendered the page nice. Now we can check, wether we have created
				// a page long enough to fit the NEXT page. If so, we are going to estimate it's
				// content to create next page(s) with EXACTLY the required html - this will
				// speed up the render
				var LastChild = <HTMLElement> this.Element.Node.children[this.Element.Node.children.length - 1];
				if (FallOut.EndReached && LastChild && !PageCorrupt) {
					var CollectedHeight = FallOut.Height;
					var CollectedNotesHeight = FallOut.NotesHeight;
					var PrevTo: Array;
					for (var I = 0; I < this.PagesToRender.length; I++) {
						var TestHeight = CollectedHeight + this.Element.Height
							- this.Element.MarginTop - this.Element.MarginBottom;
						if (LastChild.offsetTop + LastChild.scrollHeight > TestHeight) {
							FallOut = this.FallOut(TestHeight, CollectedNotesHeight, FallOut.FalloutElementN);
							if (FallOut.EndReached) {
								var NextPageRange = <any> {};
								NextPageRange.From = (PrevTo ? PrevTo : this.RenderInstr.Range.To).slice(0);
								PrevTo = FallOut.FallOut.slice(0);
								NextPageRange.To = FallOut.FallOut.slice(0);

								this.PagesToRender[I].Height = FallOut.Height - CollectedHeight + this.Element.MarginTop;
								this.PagesToRender[I].NotesHeight = FallOut.NotesHeight;
								CollectedHeight = FallOut.Height;
								CollectedNotesHeight += FallOut.NotesHeight;
								this.PagesToRender[I].Range = NextPageRange;
								if (this.PagesToRender[I].CacheAs !== undefined) {
									this.FBReader.StoreCachedPage(this.PagesToRender[I]);
								}
							} else { break }
						} else { break }
					}
				}
			} else {
				this.PageN = this.RenderInstr.CacheAs;
			}

			//			this.ParentElement.style.height = (this.RenderInstr.Height + this.RenderInstr.NotesHeight + this.NotesElement.MarginTop) + 'px';
			this.Element.Node.style.height = (this.RenderInstr.Height - this.Element.MarginBottom - this.Element.MarginTop) + 'px';
			if (this.RenderInstr.NotesHeight) {
				this.NotesElement.Node.style.height = (this.RenderInstr.NotesHeight) + 'px';
				this.NotesElement.Node.style.top = (this.Element.Height
				- this.Element.MarginTop
				- this.RenderInstr.NotesHeight
				- this.NotesElement.MarginBottom) + 'px'
			} else {
				this.NotesElement.Node.style.display = 'none'
			}
			this.Element.Node.style.overflow = 'hidden';

			this.Ready = true;
			this.Pending = false;

			// We have a queue waiting and it is not a background renderer frame - then fire the next page fullfilment
			if (this.PagesToRender && this.PagesToRender.length && this.Next) {
				// we fire setTimeout to let the browser draw the page before we render the next
				if (!this.PagesToRender[0].Range && !this.PagesToRender[0].Start) {
					this.PagesToRender[0].Start = this.RenderInstr.Range.To;
				}
				this.RenderMoreTimeout = setTimeout(() => { this.Next.DrawInit(this.PagesToRender) }, 50)
			} else if (this.Next) {
				this.FBReader.IdleOn();
			}
		}

		//public Redraw() {
		//	if (!this.Ready || !this.RenderInstr) {
		//		return
		//	}
		//	this.DrawInit([FB3Reader.PRIClone(this.RenderInstr)]);
		//}

		Reset() {
			clearTimeout(this.RenderMoreTimeout);
			//			console.log('Reset ' + this.ID);
			this.PagesToRender = null;
			this.Reseted = true;
			this.Pending = false;
		}

		public PutPagePlace(Place: number) {
			if (Place < 0) {
				this.Element.Node.style.display = 'none';
			} else {
				this.Element.Node.style.display = 'block';

			}
		}

		private FallOut(Limit: number, NotesShift: number, SkipUntill?: number): IFallOut {
			//		Hand mage CSS3 tabs. I thouth it would take more than this
			var Element = <HTMLElement> this.Element.Node;
			var I = SkipUntill > 0 ? SkipUntill : 0;
			var GoodHeight = 0;
			var ChildsCount = Element.children.length;
			var ForceDenyElementBreaking = true;
			var LastOffsetParent: Element;
			var LastOffsetShift: number;
			var EndReached = false;
			var FootnotesAddonCollected = 0;

			// To shift notes to the next page we may have to eliminale last line as a whole - so we keep track of it
			var LastLineBreakerParent: HTMLElement;
			var LastLineBreakerPos: number;
			var LastFullLinePosition = 0;

			var PrevPageBreaker = false;
			var NoMoreFootnotesHere = false;
			var FalloutElementN = -1;
			while (I < ChildsCount) {
				var FootnotesAddon = 0;
				var Child = <HTMLElement> Element.children[I];
				PrevPageBreaker = PrevPageBreaker || !ForceDenyElementBreaking && PageBreakBefore(Child);
				var SH = Child.scrollHeight;
				var OH = Child.offsetHeight;
				var ChildBot = Child.offsetTop + Math.max(SH, OH);

				if (SH != OH) {
					// While calculating browser's widths&heights you can find that 1+1+3. We "round" it up
					// if things look suspisiously
					ChildBot++;
				}

				if (!NoMoreFootnotesHere && this.FBReader.BookStyleNotes) {
					// Footnotes kind of expand element height - NoMoreFootnotesHere is for making things faster
					if (Child.nodeName.match(/a/i) && Child.className.match(/\bfootnote_attached\b/)) {
						var NoteElement = this.Site.getElementById('f' + Child.id);
						if (NoteElement) {
							FootnotesAddon = NoteElement.offsetTop + NoteElement.scrollHeight;
						}
					} else {
						var FootNotes = Child.getElementsByTagName('a');
						for (var J = FootNotes.length - 1; J >= 0; J--) {
							if (FootNotes[J].className.match(/\bfootnote_attached\b/)) {
								var NoteElement = this.Site.getElementById('f' + FootNotes[J].id);
								FootnotesAddon = NoteElement.offsetTop + NoteElement.scrollHeight;
								break;
							}
						}
					}
				}
				if (FootnotesAddon) {
					FootnotesAddon += this.NotesElement.MarginTop - NotesShift;
				}

				var FootnotesHeightNow = FootnotesAddon ? FootnotesAddon : FootnotesAddonCollected;
				if ((ChildBot + FootnotesHeightNow < Limit) && !PrevPageBreaker) { // Page is still not filled
					ForceDenyElementBreaking = false;
					if (FootnotesAddon) { FootnotesAddonCollected = FootnotesAddon };
					if (Math.abs(LastFullLinePosition - ChildBot) > 1) { // +1 because of the browser positioning rounding on the zoomed screen
						LastLineBreakerParent = Element;
						LastLineBreakerPos = I;
						LastFullLinePosition = ChildBot;
					}
					I++;
				} else {
					EndReached = true;
					if (FalloutElementN == -1) {
						FalloutElementN = I
					}
					if (!FootnotesAddon) {
						NoMoreFootnotesHere = true;
					}
					var CurShift: number = Child.offsetTop;
					if (Child.innerHTML.match(/^(\u00AD|\s)/)) {
						CurShift += Math.floor(Math.max(SH, OH) / 2); // what is this, hm?
					}// else {
					//	var NextChild = <HTMLElement> Element.children[I + 1];
					//if (NextChild && NextChild.innerHTML.match(/^\u00AD/)) {
					//	Child.innerHTML += '_';
					//}
					//}
					var OffsetParent = Child.offsetParent;
					var ApplyShift: number;
					if (LastOffsetParent == OffsetParent) {
						ApplyShift = CurShift - LastOffsetShift;
					} else {
						ApplyShift = CurShift;
					}
					LastOffsetShift = CurShift;

					GoodHeight += ApplyShift;
					LastOffsetParent = OffsetParent;
					Element = Child;
					ChildsCount = (!ForceDenyElementBreaking && IsNodeUnbreakable(Element)) ? 0 : Element.children.length;
					if (!PrevPageBreaker && ChildsCount == 0 && FootnotesAddon > FootnotesAddonCollected && LastLineBreakerParent) {
						// So, it looks like we do not fit because of the footnote, not the falling out text itself.
						// Let's force page break on the previous line end - kind of time machine
						I = LastLineBreakerPos;
						Element = LastLineBreakerParent;
						PrevPageBreaker = true;
						ChildsCount = Element.children.length;
						continue;
					}
					Limit = Limit - ApplyShift;
					I = 0;
					if (PrevPageBreaker) break;
				}
				//if (PrevPageBreaker) {
				//	Child.className += ' cut_bot';
				//}
			}

			var Addr: any;
			if (EndReached) {
				Addr = Element.id.split('_');
			} else {
				Addr = Child.id.split('_');
				GoodHeight = this.Element.Node.scrollHeight;
			}

			Addr.shift();
			Addr.shift();
			while (Addr[Addr.length - 1] == 0) {
				Addr.pop();
			}
			return {
				FallOut: Addr,
				Height: GoodHeight,
				NotesHeight: FootnotesAddonCollected ? FootnotesAddonCollected - this.NotesElement.MarginTop : 0,
				FalloutElementN: FalloutElementN,
				EndReached: EndReached
			};
		}
	}
}