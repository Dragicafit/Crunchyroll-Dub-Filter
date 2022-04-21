import {
  collectionEpisode,
  collectionPanel,
  collectionSeason,
  episode_metadata,
  eventsBackgroundSend,
  langToDisplay,
  languages,
  possibleLangKeys,
  regexApiEpisodes,
  regexApiObjects,
  regexApiSeasons,
  regexPageSeries,
  regexPageWatch,
  season,
  startApiUpNextSeries,
  upNextSeries,
} from "./tabConst";

export class TabOverrideXMLHttpRequest {
  private upNext: string | undefined;
  private currentEpisode:
    | (episode_metadata & {
        id: string;
      })
    | undefined;
  private seasonsWithLang: (season & {
    lang: languages;
  })[] = [];

  constructor() {}

  start(): void {
    const tabOverrideXMLHttpRequest = this;

    let _open = XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      let url2 = "";
      if (url instanceof URL) {
        url2 = url.href;
      } else if (typeof url === "string") {
        url2 = url;
      }
      let _onloadend = this.onloadend;
      const _this = this;

      this.onloadend = function () {
        if (_onloadend == null) return;

        new Promise<void>((resolve) => {
          if (_this.readyState === 4 && _this.status === 200) {
            const data = JSON.parse(_this.responseText);

            if (document.URL.match(regexPageWatch)) {
              if (url2.match(regexApiObjects)) {
                tabOverrideXMLHttpRequest.saveCurrentEpisode(data);
              } else if (url2.match(regexApiSeasons)) {
                tabOverrideXMLHttpRequest.sendLanguagesToVilos(data, url2);
              }
            } else if (document.URL.match(regexPageSeries)) {
              if (url2.match(regexApiSeasons)) {
                tabOverrideXMLHttpRequest.waitForUpNext().then((upNext) => {
                  Object.defineProperty(_this, "responseText", {
                    value: JSON.stringify(
                      tabOverrideXMLHttpRequest.concatLanguages(data, upNext)
                    ),
                  });
                  resolve();
                });
                return;
              }
              if (url2.match(regexApiEpisodes)) {
                tabOverrideXMLHttpRequest
                  .addEpisodesFromOtherLanguages(data, url2)
                  .then(() => {
                    Object.defineProperty(_this, "responseText", {
                      value: JSON.stringify(data),
                    });
                    resolve();
                  });
                return;
              } else if (url2.startsWith(startApiUpNextSeries)) {
                tabOverrideXMLHttpRequest.saveUpNext(data);
              }
            }
          }
          resolve();
        }).finally(() => {
          if (_onloadend == null) return;
          _onloadend.apply(this, <any>arguments);
        });
      };

      Object.defineProperty(this, "onloadend", {
        get: function () {
          return _onloadend;
        },
        set: function (value) {
          _onloadend = value;
        },
      });

      return _open.apply(_this, <any>arguments);
    };
  }

  private saveUpNext(dataUpNextSeries: upNextSeries) {
    this.upNext = dataUpNextSeries.panel.episode_metadata.season_id;
  }

  private saveCurrentEpisode(dataObjects: collectionPanel) {
    this.currentEpisode = {
      ...dataObjects.items[0].episode_metadata,
      id: dataObjects.items[0].id,
    };
  }

  private sendLanguagesToVilos(seasons: collectionSeason, url2: string) {
    let seasonsWithLang = this.parseSeasons(seasons.items);
    const currentSeason = seasonsWithLang.find(
      (season) => season.id === this.currentEpisode?.season_id
    )!;
    seasonsWithLang = seasonsWithLang.filter(
      (season) => season.slug_title === currentSeason.slug_title
    );
    const promiseList = [];
    for (const season of seasonsWithLang) {
      let url3 = url2.replace(
        `seasons?series_id=${season.series_id}`,
        `episodes?season_id=${season.id}`
      );
      promiseList.push(
        fetch(url3)
          .then((response) => response.json())
          .then((body: collectionEpisode) => {
            const episode = body.items.find(
              (item) =>
                item.sequence_number === this.currentEpisode?.sequence_number
            );
            if (episode == null) return;
            return {
              id: season.lang,
              name: langToDisplay[season.lang],
              url: document.URL.replace(this.currentEpisode!.id, episode.id),
            };
          })
      );
    }
    Promise.all(promiseList).then((languages) => {
      let languagesWithoutNull = languages.flatMap((language) =>
        language ? [language] : []
      );
      let languagesWithoutNullOrdered = possibleLangKeys
        .filter((lang) =>
          languagesWithoutNull.map((language) => language.id).includes(lang)
        )
        .map((lang) => languagesWithoutNull.find((lang2) => lang == lang2.id)!);
      const currentLanguageId = languagesWithoutNullOrdered.find(
        (season) => season.id == currentSeason.lang
      )?.id;
      const vilosWindow = (<HTMLIFrameElement>(
        document.getElementsByClassName("video-player")[0]
      )).contentWindow!;
      console.log("send info", {
        currentLanguage: currentLanguageId,
        languages: languagesWithoutNullOrdered,
      });
      vilosWindow.postMessage(
        {
          direction: "from-script-AWP",
          command: eventsBackgroundSend.SEND_INFO,
          currentLanguage: currentLanguageId,
          languages: languagesWithoutNullOrdered,
        },
        "https://static.crunchyroll.com/vilos-v2/web/vilos/player.html"
      );
    });
  }

  private async addEpisodesFromOtherLanguages(
    episodes: collectionEpisode,
    url2: string
  ) {
    const currentSeasonId = episodes.items[0].season_id;
    let currentSeasonsWithLang = this.seasonsWithLang.find(
      (season) => season.id === currentSeasonId
    )!;
    let sameSeasonsWithLang = this.seasonsWithLang.filter(
      (season) => season.slug_title === currentSeasonsWithLang.slug_title
    );
    const promiseList = [];
    for (const season of sameSeasonsWithLang) {
      if (season.id === currentSeasonId) {
        continue;
      }
      let url3 = url2.replace(
        `episodes?season_id=${currentSeasonId}`,
        `episodes?season_id=${season.id}`
      );
      promiseList.push(
        fetch(url3)
          .then((response) => response.json())
          .then((body: collectionEpisode) => {
            body.items.forEach((episode) => {
              if (
                !episodes.items.find(
                  (alreadyPresentEpisode) =>
                    episode.sequence_number ===
                    alreadyPresentEpisode.sequence_number
                )
              ) {
                episodes.items.push(episode);
              }
            });
          })
      );
    }
    await Promise.all(promiseList);
    episodes.items.sort(
      (episode1, episode2) =>
        episode1.sequence_number - episode2.sequence_number
    );
    return episodes;
  }

  private parseSeasons(seasons: season[]) {
    return seasons.map((season) => {
      const seasonWithLang = <season & { lang: languages }>season;
      if (seasonWithLang.is_subbed) {
        seasonWithLang.lang = "SUB";
      } else if (seasonWithLang.slug_title.match(/-english(-dub)?$/)) {
        seasonWithLang.lang = "EN";
      } else if (seasonWithLang.slug_title.match(/-french(-dub)?$/)) {
        seasonWithLang.lang = "FR";
      } else if (seasonWithLang.slug_title.match(/-spanish(-dub)?$/)) {
        seasonWithLang.lang = "ES";
      } else if (seasonWithLang.slug_title.match(/-portuguese(-dub)?$/)) {
        seasonWithLang.lang = "PT";
      } else if (seasonWithLang.slug_title.match(/-german(-dub)?$/)) {
        seasonWithLang.lang = "DE";
      } else if (seasonWithLang.slug_title.match(/-russian(-dub)?$/)) {
        seasonWithLang.lang = "RU";
      } else {
        seasonWithLang.lang = "OTHERS";
      }
      if (seasonWithLang.is_dubbed) {
        seasonWithLang.slug_title = season.slug_title.replace(
          /-english(-dub)?$|-french(-dub)?$|-spanish(-dub)?$|-portuguese(-dub)?$|-german(-dub)?$|-russian(-dub)?$/,
          ""
        );
        seasonWithLang.title = season.title.replace(
          / \(\w+? Dub\)$| \(VF\)$|\(EN\) |\(FR\) |\(ES\) |\(PT\) |\(DE\) |\(RU\) /,
          ""
        );
      } else {
        seasonWithLang.title = season.title.replace(/\(OmU\) /, "");
      }
      return seasonWithLang;
    });
  }

  private concatLanguages(data: collectionSeason, upNext: string) {
    this.seasonsWithLang = this.parseSeasons(data.items);

    let seen = new Set();
    let seasons = this.seasonsWithLang.reduce(
      (
        previousValue,
        currentValue: season & {
          lang: languages;
          langs?: languages[];
        }
      ) => {
        let k = currentValue.slug_title;
        let found = previousValue.find(
          (season) => season.slug_title === currentValue.slug_title
        );
        if (found != null) {
          found.langs.push(currentValue.lang);
          if (currentValue.is_subbed) {
            found.title = currentValue.title;
          }
          if (upNext === currentValue.id) {
            found.id = currentValue.id;
          }
        } else {
          seen.add(k);
          currentValue.langs = [currentValue.lang];
          previousValue.push(
            <
              season & {
                lang: languages;
                langs: languages[];
              }
            >currentValue
          );
        }
        return previousValue;
      },
      <
        (season & {
          lang: languages;
          langs: languages[];
        })[]
      >(<unknown[]>[])
    );
    data.items = seasons.map((season) => {
      let firstDub = true;
      for (const lang of possibleLangKeys.filter((lang) =>
        season.langs.includes(lang)
      )) {
        if (firstDub && lang !== "SUB") {
          firstDub = false;
          season.title += `, DUBS : ${lang}`;
        } else {
          season.title += `, ${lang}`;
        }
      }
      return season;
    });
    return data;
  }

  private waitForUpNext(): Promise<string> {
    return new Promise<string>((resolve) => {
      if (this.upNext == null) {
        return setTimeout(() => resolve(this.waitForUpNext()), 100);
      }

      return resolve(this.upNext);
    });
  }
}
