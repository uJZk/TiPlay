// SPDX-License-Identifier: GPL-3.0-only
// libsoxr LGPL-2.1-or-later; generated wasm2js (asm.js-like; not validated asm.js).
export default function createSoxr() {

  var bufferView;
  var base64ReverseLookup = new Uint8Array(123/*'z'+1*/);
  for (var i = 25; i >= 0; --i) {
    base64ReverseLookup[48+i] = 52+i; // '0-9'
    base64ReverseLookup[65+i] = i; // 'A-Z'
    base64ReverseLookup[97+i] = 26+i; // 'a-z'
  }
  base64ReverseLookup[43] = 62; // '+'
  base64ReverseLookup[47] = 63; // '/'
  /** @noinline Inlining this function would mean expanding the base64 string 4x times in the source code, which Closure seems to be happy to do. */
  function base64DecodeToExistingUint8Array(uint8Array, offset, b64) {
    var b1, b2, i = 0, j = offset, bLength = b64.length, end = offset + (bLength*3>>2) - (b64[bLength-2] == '=') - (b64[bLength-1] == '=');
    for (; i < bLength; i += 4) {
      b1 = base64ReverseLookup[b64.charCodeAt(i+1)];
      b2 = base64ReverseLookup[b64.charCodeAt(i+2)];
      uint8Array[j++] = base64ReverseLookup[b64.charCodeAt(i)] << 2 | b1 >> 4;
      if (j < end) uint8Array[j++] = b1 << 4 | b2 >> 2;
      if (j < end) uint8Array[j++] = b2 << 6 | base64ReverseLookup[b64.charCodeAt(i+3)];
    }
  }
function initActiveSegments(imports) {
  base64DecodeToExistingUint8Array(bufferView, 65538, "gD8AAIA/AAAATwAAAEdpbnZhbGlkIHNveHJfdCBwb2ludGVyAG51bGwgb3V0cHV0IGJ1ZmZlciBwb2ludGVyAG11c3Qgc2V0ICMgY2hhbm5lbHMgYmVmb3JlIE8vSSByYXRpbwB2YXJ5aW5nIE8vSSByYXRpbyBpcyBub3Qgc3VwcG9ydGVkIHdpdGggdGhpcyBxdWFsaXR5IGxldmVsAGlucHV0IGZ1bmN0aW9uIHJlcG9ydGVkIGZhaWx1cmUASS9PIHJhdGlvIG91dC1vZi1yYW5nZQBtYWxsb2MgZmFpbGVkAFNPWFJfTk9TTUFMTElOVE9QVABTT1hSX05VTV9USFJFQURTAFNPWFJfQ09FRl9JTlRFUlAAU09YUl9TVFJJQ1RfQlVGAFNPWFJfTUlOX0RGVF9TSVpFAFNPWFJfTEFSR0VfREZUX1NJWkUAU09YUl9DT0VGU19TSVpFAHZyMzIABAgEAgAAAAAAAwAAAAQAAAAFAAAABgAAAAcAAAAIAAAACQAAAAoAAAALAAAADA==");
  base64DecodeToExistingUint8Array(bufferView, 65956, "Yn/MN3iWyzikhIY5Dj4KOl2EaToaxqM6JEu4Oqt8jTq/2LS39mMHu5SoobuzPQS8GT0rvMZfL7y+iPS7QcHkOG1CQDwjjNE8HVccPZmwNz3GNCc98Mq5PBLGI7xof1q93lPKvQ4KCb4AgBO+XPntvYKYKr0APKU9oXd4PoWw2j4LRBw/kSlEP4vyXj/IYWg/");
  base64DecodeToExistingUint8Array(bufferView, 66116, "CcFrN3xnwzfSECg4Bs2BOMRsuDhb6PM439kWORtdLjkZ4zo5Qy42Oc0GGjloLsI4v4b9NrgC5LhUrYS5/xvbuTn1GrrXM0a6NANqutFJgLqTDYK6iYVvuj43P7ofn+O5TyINuLHD7TnVcoI6P7/KOmCPBjvAwyA7k+svO5lZMDtvPh87TUD2OgeDiDp3c0W4tfqsuiSHL7sCDIO7t36ou+1cw7sBPc+7LY/Iu3AfrbsTDHm7Ct/hukW7WDokE3A7z2nWOzp+FjzsAjk85hxOPPXfUTz0mUE8M0McPHuixTt7/MI6eW13u+7RGLwPHHC8WlOdvALFt7xeesO8eIu9vBN6pLxDBHG81hrvuxXS2jofLTw8v1yuPKWf9jwidRc9KP0nPbAFKj3iyBs9t9D5PDs5nTycCp47YBk9vCap6bxHbDa9S0RtvQV0ib0G8JC9eimLvcqObr0dayu9Oe6gvDqt4DsSrBE9MPuCPcPQtj3YqN49rFf1PXe79j1xOeA9ISSxPRMAVj3R8Aw8PfMpvdTOwL1/NxS+88VAvijcYL6Ymm++299ovsanSb6hWhC+OhV0vbIsOj0jzi4+ZlKfPpfP6z4Wlxw/0L9BPxFsYz9jyH8/mKGKPwxUkT+QmpM/");
  base64DecodeToExistingUint8Array(bufferView, 66608, "AwAAAAQAAAAEAAAABgAAAIP5ogBETm4A/CkVANFXJwDdNPUAYtvAADyZlQBBkEMAY1H+ALveqwC3YcUAOm4kANJNQgBJBuAACeouAByS0QDrHf4AKbEcAOg+pwD1NYIARLsuAJzphAC0JnAAQX5fANaROQBTgzkAnPQ5AItfhAAo+b0A+B87AN7/lwAPmAUAES/vAApaiwBtH20Az342AAnLJwBGT7cAnmY/AC3qXwC6J3UA5evHAD178QD3OQcAklKKAPtr6gAfsV8ACF2NADADVgB7/EYA8KtrACC8zwA29JoA46kdAF5hkQAIG+YAhZllAKAUXwCNQGgAgNj/ACdzTQAGBjEAylYVAMmocwB74mAAa4zAABnERwDNZ8MACejcAFmDKgCLdsQAphyWAESv3QAZV9EApT4FAAUH/wAzfj8AwjLoAJhP3gC7fTIAJj3DAB5r7wCf+F4ANR86AH/yygDxhx0AfJAhAGokfADVbvoAMC13ABU7QwC1FMYAwxmdAK3EwgAsTUEADABdAIZ9RgDjcS0Am8aaADNiAAC00nwAtKeXADdV1QDXPvYAoxAYAE12/ABknSoAcNerAGN8+AB6sFcAFxXnAMBJVgA71tkAp4Q4ACQjywDWincAWlQjAAAfuQDxChsAGc7fAJ8x/wBmHmoAmVdhAKz7RwB+f9gAImW3ADLoiQDmv2AA78TNAGw2CQBdP9QAFt7XAFg73gDem5IA0iIoACiG6ADiWE0AxsoyAAjjFgDgfcsAF8BQAPMdpwAY4FsALhM0AIMSYgCDSAEA9Y5bAK2wfwAe6fIASEpDABBn0wCq3dgArl9CAGphzgAKKKQA05m0AAam8gBcd38Ao8KDAGE8iACKc3gAr4xaAG/XvQAtpmMA9L/LAI2B7wAmwWcAVcpFAMrZNgAoqNIAwmGNABLJdwAEJhQAEkabAMRZxADIxUQATbKRAAAX8wDUQ60AKUnlAP3VEAAAvvwAHpTMAHDO7gATPvUA7PGAALPnwwDH+CgAkwWUAMFxPgAuCbMAC0XzAIgSnACrIHsALrWfAEeSwgB7Mi8ADFVtAHKnkABr5x8AMcuWAHkWSgBBeeIA9N+JAOiUlwDi5oQAmTGXAIjtawBfXzYAu/0OAEiatABnpGwAcXJCAI1dMgCfFbgAvOUJAI0xJQD3dDkAMAUcAA0MAQBLCGgALO5YAEeqkAB05wIAvdYkAPd9pgBuSHIAnxbvAI6UpgC0kfYA0VNRAM8K8gAgmDMA9Ut+ALJjaADdPl8AQF0DAIWJfwBVUikAN2TAAG3YEAAySDIAW0x1AE5x1ABFVG4ACwnBACr1aQAUZtUAJwedAF0EUAC0O9sA6nbFAIf5FwBJa30AHSe6AJZpKQDGzKwArRRUAJDiagCI2YkALHJQAASkvgB3B5QA8zBwAAD8JwDqcagAZsJJAGTgPQCX3YMAoz+XAEOU/QANhowAMUHeAJI5nQDdcIwAF7fnAAjfOwAVNysAXICgAFqAkwAQEZIAD+jYAGyArwDb/0sAOJAPAFkYdgBipRUAYcu7AMeJuQAQQL0A0vIEAEl1JwDrtvYA2yK7AAoUqgCJJi8AZIN2AAk7MwAOlBoAUTqqAB2jwgCv7a4AXCYSAG3CTQAtepwAwFaXAAM/gwAJ8PYAK0CMAG0xmQA5tAcADCAVANjDWwD1ksQAxq1LAE7KpQCnN80A5qk2AKuSlADdQmgAGWPeAHaM7wBoi1IA/Ns3AK6hqwDfFTEAAK6hAAz72gBkTWYA7QW3ACllMABXVr8AR/86AGr5uQB1vvMAKJPfAKuAMABmjPYABMsVAPoiBgDZ5B0APbOkAFcbjwA2zQkATkLpABO+pAAzI7UA8KoaAE9lqADSwaUACz8PAFt4zQAj+XYAe4sEAIkXcgDGplMAb27iAO/rAACbSlgAxNq3AKpmugB2z88A0QIdALHxLQCMmcEAw613AIZI2gD3XaAAxoD0AKzwLwDd7JoAP1y8ANDebQCQxx8AKtu2AKMlOgAAr5oArVOTALZXBAApLbQAS4B+ANoHpwB2qg4Ae1mhABYSKgDcty0A+uX9AInb/gCJvv0A5HZsAAap/AA+gHAAhW4VAP2H/wAoPgcAYWczACoYhgBNveoAs+evAI9tbgCVZzkAMb9bAITXSAAw3xYAxy1DACVhNQDJcM4AMMu4AL9s/QCkAKIABWzkAFrdoAAhb0cAYhLSALlchABwYUkAa1bgAJlSAQBQVTcAHtW3ADPxxAATbl8AXTDkAIUuqQAdssMAoTI2AAi3pADqsdQAFvchAI9p5AAn/3cADAOAAI1ALQBPzaAAIKWZALOi0wAvXQoAtPlCABHaywB9vtAAm9vBAKsXvQDKooEACGpcAC5VFwAnAFUAfxTwAOEHhgAUC2QAlkGNAIe+3gDa/SoAayW2AHuJNAAF8/4Aub+eAGhqTwBKKqgAT8RaAC34vADXWpgA9MeVAA1NjQAgOqYApFdfABQ/sQCAOJUAzCABAHHdhgDJ3rYAv2D1AE1lEQABB2sAjLCsALLA0ABRVUgAHvsOAJVywwCjBjsAwEA1AAbcewDgRcwATin6ANbKyADo80EAfGTeAJtk2ADZvjEApJfDAHdY1ABp48UA8NoTALo6PABGGEYAVXVfANK99QBuksYArC5dAA5E7QAcPkIAYcSHACn96QDn1vMAInzKAG+RNQAI4MUA/9eNAG5q4gCw/cYAkwjBAHxddABrrbIAzW6dAD5yewDGEWoA98+pAClz3wC1yboAtwBRAOKyDQB0uiQA5X1gAHTYigANFSwAgRgMAH5mlAABKRYAn3p2AP39vgBWRe8A2X42AOzZEwCLurkAxJf8ADGoJwDxbsMAlMU2ANioVgC0qLUAz8wOABKJLQBvVzQALFaJAJnO4wDWILkAa16qAD4qnAARX8wA/QtKAOH0+wCOO20A4oYsAOnUhAD8tKkA7+7RAC41yQAvOWEAOCFEABvZyACB/AoA+0pqAC8c2ABTtIQATpmMAFQizAAqVdwAwMbWAAsZlgAacLgAaZVkACZaYAA/Uu4AfxEPAPS1EQD8y/UANLwtADS87gDoXcwA3V5gAGeOmwCSM+8AyRe4AGFYmwDhV7wAUYPGANg+EADdcUgALRzdAK8YoQAhLEYAWfPXANl6mACeVMAAT4b6AFYG/ADlea4AiSI2ADitIgBnk9wAVeiqAIImOADK55sAUQ2kAJkzsQCp1w4AaQVIAGWy8AB/iKcAiEyXAPnRNgAhkrMAe4JKAJjPIQBAn9wA3EdVAOF0OgBn60IA/p3fAF7UXwB7Z6QAuqx6AFX2ogAriCMAQbpVAFluCAAhKoYAOUeDAInj5gDlntQASftAAP9W6QAcD8oAxVmKAJT6KwDTwcUAD8XPANtargBHxYYAhUNiACGGOwAseZQAEGGHACpMewCALBoAQ78SAIgmkAB4PIkAqMTkAOXbewDEOsIAJvTqAPdnigANkr8AZaMrAD2TsQC9fAsApFHcACfdYwBp4d0AmpQZAKgplQBozigACe20AESfIABOmMoAcIJjAH58IwAPuTIAp/WOABRW5wAh8QgAtZ0qAG9+TQClGVEAtfmrAILf1gCW3WEAFjYCAMQ6nwCDoqEAcu1tADmNegCCuKkAazJcAEYnWwAANO0A0gB3APz0VQABWU0A4HGA");
  base64DecodeToExistingUint8Array(bufferView, 69395, "QPsh+T8AAAAALUR0PgAAAICYRvg8AAAAYFHMeDsAAACAgxvwOQAAAEAgJXo4AAAAgCKC4zYAAAAAHfNpNQA4+v5CLuY/MGfHk1fzLj0BAAAAAADgv1swUVVVVdU/kEXr////z78RAfEks5nJP5/IBuV1VcW/AAAAAAAA4L93VVVVVVXVP8v9/////8+/DN2VmZmZyT+nRWdVVVXFvzDeRKMkScI/ZT1CpP//v7/K1ioohHG8P/9osEPrmbm/hdCv94KBtz/NRdF1E1K1v5/e4MPwNPc/AJDmeX/M178f6SxqeBP3PwAADcLub9e/oLX6CGDy9j8A4FET4xPXv32MEx+m0fY/AHgoOFu41r/RtMULSbH2PwB4gJBVXda/ugwvM0eR9j8AABh20ALWvyNCIhifcfY/AJCQhsqo1b/ZHqWZT1L2PwBQA1ZDT9W/xCSPqlYz9j8AQGvDN/bUvxTcnWuzFPY/AFCo/aed1L9MXMZSZPb1PwCoiTmSRdS/TyyRtWfY9T8AuLA59O3Tv96QW8u8uvU/AHCPRM6W0794GtnyYZ31PwCgvRceQNO/h1ZGElaA9T8AgEbv4unSv9Nr586XY/U/AOAwOBuU0r+Tf6fiJUf1PwCI2ozFPtK/g0UGQv8q9T8AkCcp4enRv9+9stsiD/U/APhIK22V0b/X3jRHj/P0PwD4uZpnQdG/QCjez0PY9D8AmO+U0O3Qv8ijeMA+vfQ/ABDbGKWa0L+KJeDDf6L0PwC4Y1LmR9C/NITUJAWI9D8A8IZFIuvPvwstGRvObfQ/ALAXdUpHz79UGDnT2VP0PwAwED1EpM6/WoS0RCc69D8AsOlEDQLOv/v4FUG1IPQ/APB3KaJgzb+x9D7aggf0PwCQlQQBwMy/j/5XXY/u8z8AEIlWKSDMv+lMC6DZ1fM/ABCBjReBy78rwRDAYL3zPwDQ08zJ4sq/uNp1KySl8z8AkBIuQEXKvwLQn80ijfM/APAdaHeoyb8ceoTFW3XzPwAwSGltDMm/4jatSc5d8z8AwEWmIHHIv0DUTZh5RvM/ADAUtI/Wx78ky//OXC/zPwBwYjy4PMe/SQ2hdXcY8z8AYDebmqPGv5A5PjfIAfM/AKC3VDELxr9B+JW7TuvyPwAwJHZ9c8W/0akZAgrV8j8AMMKPe9zEvyr9t6j5vvI/AADSUSxGxL+rGwx6HKnyPwAAg7yKsMO/MLUUYHKT8j8AAElrmRvDv/WhV1f6ffI/AECkkFSHwr+/Ox2bs2jyPwCgefi588G/vfWPg51T8j8AoCwlyGDBvzsIyaq3PvI/ACD3V3/OwL+2QKkrASryPwCg/kncPMC/MkHMlnkV8j8AgEu8vVe/v5v80h0gAfI/AEBAlgg3vr8LSE1J9OzxPwBA+T6YF72/aWWPUvXY8T8AoNhOZ/m7v3x+VxEjxfE/AGAvIHncur/pJst0fLHxPwCAKOfDwLm/thosDAGe8T8AwHKzRqa4v71wtnuwivE/AACsswGNt7+2vO8linfxPwAAOEXxdLa/2jFMNY1k8T8AgIdtDl61v91fJ5C5UfE/AOCh3lxItL9M0jKkDj/xPwCgak3ZM7O/2vkQcoss8T8AYMX4eSCyvzG17CgwGvE/ACBimEYOsb+vNITa+wfxPwAA0mps+q+/s2tOD+718D8AQHdKjdqtv86fKl0G5PA/AACF5Oy8q78hpSxjRNLwPwDAEkCJoam/GpjifKfA8D8AwAIzWIinv9E2xoMvr/A/AIDWZ15xpb85E6CY253wPwCAZUmKXKO/3+dSr6uM8D8AQBVk40mhv/soTi+fe/A/AIDrgsBynr8ZjzWMtWrwPwCAUlLxVZq/LPnspe5Z8D8AgIHPYj2Wv5As0c1JSfA/AACqjPsokr+prfDGxjjwPwAA+SB7MYy/qTJ5E2Uo8D8AAKpdNRmEv0hz6ickGPA/AADswgMSeL+VsRQGBAjwPwAAJHkJBGC/Gvom9x/g7z8AAJCE8+9vP3TqYcIcoe8/AAA9NUHchz8umYGwEGPvPwCAwsSjzpM/za3uPPYl7z8AAIkUwZ+bP+cTkQPI6e4/AAARztiwoT+rsct4gK7uPwDAAdBbiqU/mwydohp07j8AgNhAg1ypP7WZCoOROu4/AIBX72onrT9WmmAJ4AHuPwDAmOWYdbA/mLt35QHK7T8AIA3j9VOyPwORfAvyku0/AAA4i90utD/OXPtmrFztPwDAV4dZBrY/nd5eqiwn7T8AAGo1dtq3P80saz5u8uw/AGAcTkOruT8Ceaeibb7sPwBgDbvHeLs/bQg3bSaL7D8AIOcyE0O9PwRYXb2UWOw/AGDecTEKvz+Mn7sztSbsPwBAkSsVZ8A/P+fs7oP16z8AsJKChUfBP8GW23X9xOs/ADDKzW4mwj8oSoYMHpXrPwBQxabXA8M/LD7vxeJl6z8AEDM8w9/DP4uIyWdIN+s/AIB6aza6xD9KMB0hSwnrPwDw0Sg5k8U/fu/yhejb6j8A8BgkzWrGP6I9YDEdr+o/AJBm7PhAxz+nWNM/5oLqPwDwGvXAFcg/i3MJ70BX6j8AgPZUKenIPydLq5AqLOo/AED4Aja7yT/R8pMToAHqPwAALBzti8o/GzzbJJ/X6T8A0AFcUVvLP5CxxwUlruk/AMC8zGcpzD8vzpfyLoXpPwBgSNU19sw/dUuk7rpc6T8AwEY0vcHNPzhI553GNOk/AODPuAGMzj/mUmcvTw3pPwCQF8AJVc8/ndf/jlLm6D8AuB8SbA7QP3wAzJ/Ov+g/ANCTDrhx0D8Ow77awJnoPwBwhp5r1NA/+xcjqid06D8A0EszhzbRPwias6wAT+g/AEgjZw2Y0T9VPmXoSSroPwCAzOD/+NE/YAL0lQEG6D8AaGPXX1nSPymj4GMl4uc/AKgUCTC50j+ttdx3s77nPwBgQxByGNM/wiWXZ6qb5z8AGOxtJnfTP1cGF/IHeec/ADCv+0/V0z8ME9bbylbnPwDgL+PuMtQ/a7ZPAQAQ5j88W0KRbAJ+PJW0TQMAMOY/QV0ASOq/jTx41JQNAFDmP7el1oanf448rW9OBwBw5j9MJVRr6vxhPK4P3/7/j+Y//Q5ZTCd+fLy8xWMHALDmPwHa3EhowYq89sFcHgDQ5j8Rk0mdHD+DPD72Bev/7+Y/Uy3iGgSAfryAl4YOABDnP1J5CXFm/3s8Euln/P8v5z8kh70m4gCMPGoRgd//T+c/0gHxbpECbryQnGcPAHDnP3ScVM1x/Ge8Nch++v+P5z+DBPWewb6BPObCIP7/r+c/ZWTMKRd+cLwAyT/t/8/nPxyLewhygIC8dhom6f/v5z+u+Z1tKMCNPOijnAQAEOg/M0zlUdJ/iTyPLJMXADDoP4HzMLbp/oq8nHMzBgBQ6D+8NWVrv7+JPMaJQiAAcOg/dXsR82W/i7wEefXr/4/oP1fLPaJuAIm83wS8IgCw6D8KS+A43wB9vIobDOX/z+g/BZ//RnEAiLxDjpH8/+/oPzhwetB7gYM8x1/6HgAQ6T8DtN92kT6JPLl7RhMAMOk/dgKYS06AfzxvB+7m/0/pPy5i/9nwfo+80RI83v9v6T+6OCaWqoJwvA2KRfT/j+k/76hkkRuAh7w+Lpjd/6/pPzeTWorgQIe8ZvtJ7f/P6T8A4JvBCM4/PFGc8SAA8Ok/CluIJ6o/irwGsEURABDqP1baWJlI/3Q8+va7BwAw6j8YbSuKq76MPHkdlxAAUOo/MHl43cr+iDxILvUdAHDqP9ur2D12QY+8UjNZHACQ6j8SdsKEAr+OvEs+TyoAsOo/Xz//PAT9abzRHq7X/8/qP7RwkBLnPoK8eARR7v/v6j+j3g7gPgZqPFsNZdv/D+s/uQofOMgGWjxXyqr+/y/rPx08I3QeAXm83LqV2f9P6z+fKoZoEP95vJxlniQAcOs/Pk+G0EX/ijxAFof5/4/rP/nDwpZ3/nw8T8sE0v+v6z/EK/LuJ/9jvEVcQdL/z+s/Ieo77rf/bLzfCWP4/+/rP1wLLpcDQYG8U3a14f8P7D8ZareUZMGLPONX+vH/L+w/7cYwje/+ZLwk5L/c/0/sP3VH7LxoP4S897lU7f9v7D/s4FPwo36EPNWPmev/j+w/8ZL5jQaDczyaISUhALDsPwQOGGSO/Wi8nEaU3f/P7D9y6sccvn6OPHbE/er/7+w//oifrTm+jjwr+JoWABDtP3FauaiRfXU8HfcPDQAw7T/ax3BpkMGJPMQPeer/T+0/DP5YxTcOWLzlh9wuAHDtP0QPwU3WgH+8qoLcIQCQ7T9cXP2Uj3x0vIMCa9j/r+0/fmEhxR1/jDw5R2wpANDtP1Ox/7KeAYg89ZBE5f/v7T+JzFLG0gBuPJT2q83/D+4/0mktIECDf7zdyFLb/y/uP2QIG8rBAHs87xZC8v9P7j9Rq5SwqP9yPBFeiuj/b+4/Wb7vsXP2V7wN/54RAJDuPwHIC16NgIS8RBel3/+v7j+1IEPVBgB4PKF/EhoA0O4/klxWYPgCULzEvLoHAPDuPxHmNV1EQIW8Ao169f8P7z8Fke85MftPvMeK5R4AMO8/VRFz8qyBijyUNIL1/0/vP0PH19RBP4o8a0yp/P9v7z91eJgc9AJivEHE+eH/j+8/S+d39NF9dzx+4+DS/6/vPzGjfJoZAW+8nuR3HADQ7z+xrM5L7oFxPDHD4Pf/7+8/WodwATcFbrxuYGX0/w/wP9oKHEmtfoq8WHqG8/8v8D/gsvzDaX+XvBcN/P3/T/A/W5TLNP6/lzyCTc0DAHDwP8tW5MCDAII86Mvy+f+P8D8adTe+3/9tvGXaDAEAsPA/6ybmrn8/kbw406QBANDwP/efSHn6fYA8/f3a+v/v8D/Aa9ZwBQR3vJb9ugsAEPE/YgtthNSAjjxd9OX6/y/xP+82/WT6v5082ZrVDQBQ8T+uUBJwdwCaPJpVIQ8AcPE/7t7j4vn9jTwmVCf8/4/xP3NyO9wwAJE8WTw9EgCw8T+IAQOAeX+ZPLeeKfj/z/E/Z4yfqzL5ZbwA1Ir0/+/xP+tbp52/f5M8pIaLDAAQ8j8iW/2Ra4CfPANDhQMAMPI/M7+f68L/kzyE9rz//0/yP3IuLn7nAXY82SEp9f9v8j9hDH92u/x/PDw6kxQAkPI/K0ECPMoCcrwTY1UUALDyPwIf8jOCgJK8O1L+6//P8j/y3E84fv+IvJatuAsA8PI/xUEwUFH/hbyv4nr7/w/zP50oXohxAIG8f1+s/v8v8z8Vt7c/Xf+RvFZnpgwAUPM/vYKLIoJ/lTwh9/sRAHDzP8zVDcS6AIA8uS9Z+f+P8z9Rp7ItnT+UvELS3QQAsPM/4Th2cGt/hTxXybL1/8/zPzESvxA6Ano8GLSw6v/v8z+wUrFmbX+YPPSvMhUAEPQ/JIUZXzf4Zzwpi0cXADD0P0NR3HLmAYM8Y7SV5/9P9D9aibK4af+JPOB1BOj/b/Q/VPLCm7HAlbznwW/v/4/0P3IqOvIJQJs8BKe+5f+v9D9FfQ2/t/+UvN4nEBcA0PQ/PWrccWTAmbziPvAPAPD0PxxThQuJf5c80UvcEgAQ9T82pGZxZQRgPHonBRYAMPU/CTIjzs6/lrxMcNvs/0/1P9ehBQVyAom8qVRf7/9v9T8SZMkO5r+bPBIQ5hcAkPU/kO+vgcV+iDySPskDALD1P8AMvwoIQZ+8vBlJHQDQ9T8pRyX7KoGYvIl6uOf/7/U/BGntgLd+lLw=");
  base64DecodeToExistingUint8Array(bufferView, 73696, "/////w==");
}

  var scratchBuffer = new ArrayBuffer(16);
  var i32ScratchView = new Int32Array(scratchBuffer);
  var f32ScratchView = new Float32Array(scratchBuffer);
  var f64ScratchView = new Float64Array(scratchBuffer);
  
  function wasm2js_scratch_load_i32(index) {
    return i32ScratchView[index];
  }
      
  function wasm2js_scratch_store_i32(index, value) {
    i32ScratchView[index] = value;
  }
      
  function wasm2js_scratch_load_f64() {
    return f64ScratchView[0];
  }
      
  function wasm2js_scratch_store_f64(value) {
    f64ScratchView[0] = value;
  }
      function wasm2js_trap() { throw new Error('abort'); }

function asmFunc(imports) {
 var buffer = new ArrayBuffer(16777216);
 var HEAP8 = new Int8Array(buffer);
 var HEAP16 = new Int16Array(buffer);
 var HEAP32 = new Int32Array(buffer);
 var HEAPU8 = new Uint8Array(buffer);
 var HEAPU16 = new Uint16Array(buffer);
 var HEAPU32 = new Uint32Array(buffer);
 var HEAPF32 = new Float32Array(buffer);
 var HEAPF64 = new Float64Array(buffer);
 var Math_imul = Math.imul;
 var Math_fround = Math.fround;
 var Math_abs = Math.abs;
 var Math_clz32 = Math.clz32;
 var Math_min = Math.min;
 var Math_max = Math.max;
 var Math_floor = Math.floor;
 var Math_ceil = Math.ceil;
 var Math_trunc = Math.trunc;
 var Math_sqrt = Math.sqrt;
 var wasi_snapshot_preview1 = imports.wasi_snapshot_preview1;
 var fimport$0 = wasi_snapshot_preview1.environ_get;
 var fimport$1 = wasi_snapshot_preview1.environ_sizes_get;
 var fimport$3 = wasi_snapshot_preview1.proc_exit;
 var fimport$4 = wasi_snapshot_preview1.random_get;
 var legalimport$fimport$2 = wasi_snapshot_preview1.clock_time_get;
 var global$0 = 65536;
 var __wasm_intrinsics_temp_i64 = 0;
 var __wasm_intrinsics_temp_i64$hi = 0;
 var i64toi32_i32$HIGH_BITS = 0;
 function $0() {
  var $0_1 = 0, $1_1 = 0, wasm2js_i32$0 = 0, wasm2js_i32$1 = 0, wasm2js_i32$2 = 0;
  if (HEAP32[73712 >> 2] | 0) {
   wasm2js_trap()
  }
  HEAP32[73712 >> 2] = 1;
  $0_1 = global$0 - 16 | 0;
  global$0 = $0_1;
  $1_1 = fimport$4($0_1 + 12 | 0 | 0, 4 | 0) | 0;
  HEAP32[291340 >> 2] = (wasm2js_i32$0 = -1645463780, wasm2js_i32$1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0, wasm2js_i32$2 = $1_1 & 65535 | 0, wasm2js_i32$2 ? wasm2js_i32$0 : wasm2js_i32$1);
  global$0 = $0_1 + 16 | 0;
 }
 
 function $1($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = +$1_1;
  $2_1 = $2_1 | 0;
  var $3_1 = 0, $4_1 = 0, $5_1 = 0, $6_1 = 0, $74 = 0, $117 = 0, $175 = 0, $7_1 = 0;
  $6_1 = global$0 - 16 | 0;
  global$0 = $6_1;
  block : {
   if (!$0_1) {
    $4_1 = 65552;
    break block;
   }
   $4_1 = HEAP32[($0_1 + 16 | 0) >> 2] | 0;
   if ($4_1) {
    break block
   }
   if (!(HEAP32[$0_1 >> 2] | 0)) {
    $4_1 = 65602;
    break block;
   }
   if ($1_1 <= 0.0) {
    $4_1 = 65730;
    break block;
   }
   if (!(HEAP32[($0_1 + 180 | 0) >> 2] | 0)) {
    HEAPF64[($0_1 + 8 | 0) >> 3] = $1_1;
    FUNCTION_TABLE[HEAP32[($0_1 + 156 | 0) >> 2] | 0 | 0]($6_1 + 12 | 0, $6_1 + 8 | 0);
    $2_1 = HEAP32[$0_1 >> 2] | 0;
    $4_1 = $2(4 | 0, $2_1 | 0) | 0;
    HEAP32[($0_1 + 180 | 0) >> 2] = $4_1;
    $5_1 = $2(HEAP32[($6_1 + 12 | 0) >> 2] | 0 | 0, 1 | 0) | 0;
    HEAP32[($0_1 + 124 | 0) >> 2] = $5_1;
    $3_1 = $2(4 | 0, $2_1 | 0) | 0;
    HEAP32[($0_1 + 128 | 0) >> 2] = $3_1;
    block3 : {
     block4 : {
      block2 : {
       block1 : {
        if (!$5_1) {
         break block1
        }
        if (!$4_1) {
         break block1
        }
        if (!$3_1) {
         break block1
        }
        if ($2_1) {
         break block2
        }
        $4_1 = 0;
        break block;
       }
       $4_1 = 65753;
       if (!$3_1) {
        $3_1 = 0;
        break block3;
       }
       if (!$2_1) {
        break block3
       }
       $3_1 = 0;
       $2_1 = 0;
       label : while (1) {
        $4_1 = HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0;
        if ($4_1) {
         FUNCTION_TABLE[HEAP32[($0_1 + 148 | 0) >> 2] | 0 | 0]($4_1);
         $74 = HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0;
        } else {
         $74 = 0
        }
        $37($74 | 0);
        $3_1 = $3_1 + 4 | 0;
        $2_1 = $2_1 + 1 | 0;
        if ($2_1 >>> 0 < (HEAP32[$0_1 >> 2] | 0) >>> 0) {
         continue label
        }
        break label;
       };
       $4_1 = 65753;
       break block4;
      }
      $5_1 = $0_1 + 88 | 0;
      $7_1 = $0_1 + 24 | 0;
      $3_1 = 0;
      $2_1 = 0;
      block5 : {
       label2 : while (1) {
        $4_1 = $2(HEAP32[($6_1 + 8 | 0) >> 2] | 0 | 0, 1 | 0) | 0;
        HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] = $4_1;
        if (!$4_1) {
         if (!(HEAP32[($0_1 + 128 | 0) >> 2] | 0)) {
          $4_1 = 65753;
          $3_1 = 0;
          break block3;
         }
         $3_1 = 0;
         $2_1 = 0;
         label1 : while (1) {
          $4_1 = HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0;
          if ($4_1) {
           FUNCTION_TABLE[HEAP32[($0_1 + 148 | 0) >> 2] | 0 | 0]($4_1);
           $117 = HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0;
          } else {
           $117 = 0
          }
          $37($117 | 0);
          $3_1 = $3_1 + 4 | 0;
          $2_1 = $2_1 + 1 | 0;
          if ($2_1 >>> 0 < (HEAP32[$0_1 >> 2] | 0) >>> 0) {
           continue label1
          }
          break label1;
         };
         $4_1 = 65753;
         break block4;
        }
        $4_1 = FUNCTION_TABLE[HEAP32[($0_1 + 160 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0, HEAP32[($0_1 + 124 | 0) >> 2] | 0, +HEAPF64[($0_1 + 8 | 0) >> 3], $7_1, $5_1, +HEAPF64[($0_1 + 72 | 0) >> 3]) | 0;
        if ($4_1) {
         break block5
        }
        $3_1 = $3_1 + 4 | 0;
        $2_1 = $2_1 + 1 | 0;
        if ($2_1 >>> 0 < (HEAP32[$0_1 >> 2] | 0) >>> 0) {
         continue label2
        }
        break label2;
       };
       $4_1 = 0;
       break block;
      }
      $3_1 = HEAP32[($0_1 + 128 | 0) >> 2] | 0;
      if (!$3_1) {
       $3_1 = 0;
       break block3;
      }
      if (!(HEAP32[$0_1 >> 2] | 0)) {
       break block3
      }
      $3_1 = 0;
      $5_1 = 0;
      label3 : while (1) {
       $2_1 = HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0;
       if ($2_1) {
        FUNCTION_TABLE[HEAP32[($0_1 + 148 | 0) >> 2] | 0 | 0]($2_1);
        $175 = HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0;
       } else {
        $175 = 0
       }
       $37($175 | 0);
       $3_1 = $3_1 + 4 | 0;
       $5_1 = $5_1 + 1 | 0;
       if ($5_1 >>> 0 < (HEAP32[$0_1 >> 2] | 0) >>> 0) {
        continue label3
       }
       break label3;
      };
     }
     $3_1 = HEAP32[($0_1 + 128 | 0) >> 2] | 0;
    }
    $37($3_1 | 0);
    $37(HEAP32[($0_1 + 180 | 0) >> 2] | 0 | 0);
    $37(HEAP32[($0_1 + 124 | 0) >> 2] | 0 | 0);
    $42($0_1 | 0, 200 | 0);
    HEAP32[($0_1 + 16 | 0) >> 2] = $4_1;
    break block;
   }
   if (HEAP32[($0_1 + 164 | 0) >> 2] | 0) {
    $4_1 = 0;
    label4 : while (1) {
     FUNCTION_TABLE[HEAP32[($0_1 + 164 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0, $1_1, $2_1);
     $3_1 = $3_1 + 4 | 0;
     $5_1 = $5_1 + 1 | 0;
     if ($5_1 >>> 0 < (HEAP32[$0_1 >> 2] | 0) >>> 0) {
      continue label4
     }
     break label4;
    };
    break block;
   }
   $4_1 = Math_abs(+HEAPF64[($0_1 + 8 | 0) >> 3] - $1_1) < 1.0e-15 ? 0 : 65639;
  }
  global$0 = $6_1 + 16 | 0;
  return $4_1 | 0;
 }
 
 function $2($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var i64toi32_i32$0 = 0, $2_1 = 0, i64toi32_i32$1 = 0, i64toi32_i32$4 = 0, $6_1 = 0, i64toi32_i32$3 = 0, $12_1 = 0, $9$hi = 0, $11$hi = 0, $21_1 = 0, i64toi32_i32$2 = 0;
  block1 : {
   block : {
    $6_1 = 0;
    if (!$0_1) {
     break block
    }
    i64toi32_i32$0 = 0;
    $9$hi = i64toi32_i32$0;
    i64toi32_i32$0 = 0;
    $11$hi = i64toi32_i32$0;
    i64toi32_i32$0 = $9$hi;
    i64toi32_i32$1 = $11$hi;
    i64toi32_i32$1 = __wasm_i64_mul($0_1 | 0, i64toi32_i32$0 | 0, $1_1 | 0, i64toi32_i32$1 | 0) | 0;
    i64toi32_i32$0 = i64toi32_i32$HIGH_BITS;
    $2_1 = i64toi32_i32$1;
    $6_1 = $2_1;
    if (($0_1 | $1_1 | 0) >>> 0 < 65536 >>> 0) {
     break block
    }
    $21_1 = $2_1;
    i64toi32_i32$2 = $2_1;
    i64toi32_i32$1 = 0;
    i64toi32_i32$3 = 32;
    i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
    if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
     i64toi32_i32$1 = 0;
     $12_1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
    } else {
     i64toi32_i32$1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
     $12_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
    }
    $6_1 = $12_1 ? -1 : $21_1;
   }
   $2_1 = $6_1;
   $0_1 = $36($2_1 | 0) | 0;
   if (!$0_1) {
    break block1
   }
   if (!((HEAPU8[($0_1 - 4 | 0) >> 0] | 0) & 3 | 0)) {
    break block1
   }
   if (!$2_1) {
    break block1
   }
   $42($0_1 | 0, $2_1 | 0);
  }
  return $0_1 | 0;
 }
 
 function $3($0_1) {
  $0_1 = $0_1 | 0;
  $37($0_1 | 0);
 }
 
 function $4($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0, $2_1 = 0, $28_1 = 0, $3_1 = 0;
  if ($0_1) {
   block : {
    $1_1 = HEAP32[($0_1 + 128 | 0) >> 2] | 0;
    if (!$1_1) {
     $1_1 = 0;
     break block;
    }
    if (!(HEAP32[$0_1 >> 2] | 0)) {
     break block
    }
    $1_1 = 0;
    label : while (1) {
     $2_1 = HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $1_1 | 0) >> 2] | 0;
     if ($2_1) {
      FUNCTION_TABLE[HEAP32[($0_1 + 148 | 0) >> 2] | 0 | 0]($2_1);
      $28_1 = HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $1_1 | 0) >> 2] | 0;
     } else {
      $28_1 = 0
     }
     $37($28_1 | 0);
     $1_1 = $1_1 + 4 | 0;
     $3_1 = $3_1 + 1 | 0;
     if ($3_1 >>> 0 < (HEAP32[$0_1 >> 2] | 0) >>> 0) {
      continue label
     }
     break label;
    };
    $1_1 = HEAP32[($0_1 + 128 | 0) >> 2] | 0;
   }
   $37($1_1 | 0);
   $37(HEAP32[($0_1 + 180 | 0) >> 2] | 0 | 0);
   $37(HEAP32[($0_1 + 124 | 0) >> 2] | 0 | 0);
   $37($0_1 | 0);
  }
 }
 
 function $5($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $3_1 = 0, $4_1 = 0, $5_1 = 0;
  $5_1 = global$0 - 16 | 0;
  global$0 = $5_1;
  HEAP32[($5_1 + 4 | 0) >> 2] = $1_1;
  block : {
   if (HEAP32[($0_1 + 16 | 0) >> 2] | 0) {
    $2_1 = 0;
    break block;
   }
   if (!$2_1) {
    HEAP32[($0_1 + 192 | 0) >> 2] = 1;
    $2_1 = 0;
    break block;
   }
   $3_1 = HEAP32[$0_1 >> 2] | 0;
   $4_1 = HEAP32[($0_1 + 64 | 0) >> 2] | 0;
   if ($4_1 & 4 | 0) {
    if (!$3_1) {
     break block
    }
    $3_1 = 0;
    $4_1 = 0;
    label : while (1) {
     HEAP32[($5_1 + 12 | 0) >> 2] = HEAP32[($1_1 + $3_1 | 0) >> 2] | 0;
     HEAP32[($5_1 + 8 | 0) >> 2] = FUNCTION_TABLE[HEAP32[($0_1 + 132 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0, 0, $2_1) | 0;
     FUNCTION_TABLE[HEAP32[($0_1 + 172 | 0) >> 2] | 0 | 0]($5_1 + 8 | 0, HEAP32[($0_1 + 64 | 0) >> 2] | 0, $5_1 + 12 | 0, $2_1, 1);
     $3_1 = $3_1 + 4 | 0;
     $4_1 = $4_1 + 1 | 0;
     if ($4_1 >>> 0 < (HEAP32[$0_1 >> 2] | 0) >>> 0) {
      continue label
     }
     break label;
    };
    break block;
   }
   block1 : {
    if (!$3_1) {
     $1_1 = 0;
     break block1;
    }
    $3_1 = 0;
    $4_1 = 0;
    label1 : while (1) {
     $1_1 = FUNCTION_TABLE[HEAP32[($0_1 + 132 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($0_1 + 128 | 0) >> 2] | 0) + $3_1 | 0) >> 2] | 0, 0, $2_1) | 0;
     HEAP32[((HEAP32[($0_1 + 180 | 0) >> 2] | 0) + $3_1 | 0) >> 2] = $1_1;
     $3_1 = $3_1 + 4 | 0;
     $4_1 = $4_1 + 1 | 0;
     $1_1 = HEAP32[$0_1 >> 2] | 0;
     if ($4_1 >>> 0 < $1_1 >>> 0) {
      continue label1
     }
     break label1;
    };
    $4_1 = HEAP32[($0_1 + 64 | 0) >> 2] | 0;
   }
   FUNCTION_TABLE[HEAP32[($0_1 + 172 | 0) >> 2] | 0 | 0](HEAP32[($0_1 + 180 | 0) >> 2] | 0, $4_1, $5_1 + 4 | 0, $2_1, $1_1);
  }
  global$0 = $5_1 + 16 | 0;
  return $2_1 | 0;
 }
 
 function $6($1_1, $2_1, $3_1, $4_1, $5_1) {
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = $5_1 | 0;
  var $6_1 = 0, $7_1 = 0, $8_1 = 0, $12_1 = 0, $9_1 = 0, $10_1 = 0, $11_1 = 0, $13_1 = 0, $14_1 = 0, $15_1 = 0, $16_1 = 0, scratch = 0;
  $9_1 = HEAP32[$3_1 >> 2] | 0;
  block3 : {
   block1 : {
    switch ($5_1 - 1 | 0 | 0) {
    default:
     if (!$4_1) {
      break block3
     }
     if (!$5_1) {
      break block3
     }
     $14_1 = $5_1 << 2 | 0;
     $15_1 = $5_1 & -4 | 0;
     $10_1 = $5_1 & 3 | 0;
     $16_1 = $5_1 >>> 0 < 4 >>> 0;
     $8_1 = $9_1;
     label2 : while (1) {
      $2_1 = 0;
      block4 : {
       if (!$16_1) {
        $6_1 = 0;
        label : while (1) {
         $11_1 = $7_1 << 2 | 0;
         $12_1 = $1_1 + $6_1 | 0;
         $13_1 = $6_1 + $8_1 | 0;
         HEAPF32[($11_1 + (HEAP32[$12_1 >> 2] | 0) | 0) >> 2] = Math_fround(HEAPF32[$13_1 >> 2]);
         HEAPF32[((HEAP32[($12_1 + 4 | 0) >> 2] | 0) + $11_1 | 0) >> 2] = Math_fround(HEAPF32[($13_1 + 4 | 0) >> 2]);
         HEAPF32[((HEAP32[($12_1 + 8 | 0) >> 2] | 0) + $11_1 | 0) >> 2] = Math_fround(HEAPF32[($13_1 + 8 | 0) >> 2]);
         HEAPF32[((HEAP32[($12_1 + 12 | 0) >> 2] | 0) + $11_1 | 0) >> 2] = Math_fround(HEAPF32[($13_1 + 12 | 0) >> 2]);
         $6_1 = $6_1 + 16 | 0;
         $2_1 = $2_1 + 4 | 0;
         if (($15_1 | 0) != ($2_1 | 0)) {
          continue label
         }
         break label;
        };
        if (!$10_1) {
         break block4
        }
       }
       $6_1 = $2_1 << 2 | 0;
       $2_1 = $10_1;
       label1 : while (1) {
        HEAPF32[((HEAP32[($1_1 + $6_1 | 0) >> 2] | 0) + ($7_1 << 2 | 0) | 0) >> 2] = Math_fround(HEAPF32[($6_1 + $8_1 | 0) >> 2]);
        $6_1 = $6_1 + 4 | 0;
        $2_1 = $2_1 - 1 | 0;
        if ($2_1) {
         continue label1
        }
        break label1;
       };
      }
      $8_1 = $8_1 + $14_1 | 0;
      $7_1 = $7_1 + 1 | 0;
      if (($7_1 | 0) != ($4_1 | 0)) {
       continue label2
      }
      break label2;
     };
     break block3;
    case 0:
     $2_1 = $4_1 << 2 | 0;
     if (!$2_1) {
      break block3
     }
     $41(HEAP32[$1_1 >> 2] | 0 | 0, $9_1 | 0, $2_1 | 0);
     break block3;
    case 1:
     break block1;
    };
   }
   if (!$4_1) {
    break block3
   }
   $8_1 = HEAP32[($1_1 + 4 | 0) >> 2] | 0;
   $10_1 = HEAP32[$1_1 >> 2] | 0;
   if (($4_1 | 0) != (1 | 0)) {
    scratch = $4_1 & 1 | 0;
    $12_1 = $4_1 & -2 | 0;
    $6_1 = $9_1;
    $2_1 = $10_1;
    $1_1 = $8_1;
    label3 : while (1) {
     HEAPF32[$2_1 >> 2] = Math_fround(HEAPF32[$6_1 >> 2]);
     HEAPF32[$1_1 >> 2] = Math_fround(HEAPF32[($6_1 + 4 | 0) >> 2]);
     HEAPF32[($2_1 + 4 | 0) >> 2] = Math_fround(HEAPF32[($6_1 + 8 | 0) >> 2]);
     HEAPF32[($1_1 + 4 | 0) >> 2] = Math_fround(HEAPF32[($6_1 + 12 | 0) >> 2]);
     $6_1 = $6_1 + 16 | 0;
     $2_1 = $2_1 + 8 | 0;
     $1_1 = $1_1 + 8 | 0;
     $7_1 = $7_1 + 2 | 0;
     if (($12_1 | 0) != ($7_1 | 0)) {
      continue label3
     }
     break label3;
    };
    if (!scratch) {
     break block3
    }
   }
   $1_1 = $7_1 << 2 | 0;
   $2_1 = $9_1 + ($7_1 << 3 | 0) | 0;
   HEAPF32[($10_1 + $1_1 | 0) >> 2] = Math_fround(HEAPF32[$2_1 >> 2]);
   HEAPF32[($1_1 + $8_1 | 0) >> 2] = Math_fround(HEAPF32[($2_1 + 4 | 0) >> 2]);
  }
  HEAP32[$3_1 >> 2] = $9_1 + (Math_imul($4_1, $5_1) << 2 | 0) | 0;
 }
 
 function $7($1_1, $2_1, $3_1, $4_1, $5_1, $6_1) {
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = $5_1 | 0;
  $6_1 = $6_1 | 0;
  var $7_1 = 0, $8_1 = 0, $9_1 = 0, $10_1 = 0, $12_1 = 0, $15_1 = 0, $11_1 = 0, $16_1 = 0, $14_1 = 0, $13_1 = 0, scratch = 0;
  $1_1 = HEAP32[$2_1 >> 2] | 0;
  block3 : {
   block1 : {
    switch ($5_1 - 1 | 0 | 0) {
    default:
     if (!$4_1) {
      break block3
     }
     if (!$5_1) {
      break block3
     }
     $9_1 = $5_1 << 2 | 0;
     $13_1 = $5_1 & -4 | 0;
     $10_1 = $5_1 & 3 | 0;
     $14_1 = $5_1 >>> 0 < 4 >>> 0;
     $8_1 = $1_1;
     label2 : while (1) {
      $12_1 = 0;
      block4 : {
       if (!$14_1) {
        $7_1 = 0;
        label : while (1) {
         $15_1 = $7_1 + $8_1 | 0;
         $16_1 = $11_1 << 2 | 0;
         $6_1 = $3_1 + $7_1 | 0;
         HEAPF32[$15_1 >> 2] = Math_fround(HEAPF32[($16_1 + (HEAP32[$6_1 >> 2] | 0) | 0) >> 2]);
         HEAPF32[($15_1 + 4 | 0) >> 2] = Math_fround(HEAPF32[((HEAP32[($6_1 + 4 | 0) >> 2] | 0) + $16_1 | 0) >> 2]);
         HEAPF32[($15_1 + 8 | 0) >> 2] = Math_fround(HEAPF32[((HEAP32[($6_1 + 8 | 0) >> 2] | 0) + $16_1 | 0) >> 2]);
         HEAPF32[($15_1 + 12 | 0) >> 2] = Math_fround(HEAPF32[((HEAP32[($6_1 + 12 | 0) >> 2] | 0) + $16_1 | 0) >> 2]);
         $7_1 = $7_1 + 16 | 0;
         $12_1 = $12_1 + 4 | 0;
         if (($13_1 | 0) != ($12_1 | 0)) {
          continue label
         }
         break label;
        };
        if (!$10_1) {
         break block4
        }
       }
       $7_1 = $12_1 << 2 | 0;
       $6_1 = $10_1;
       label1 : while (1) {
        HEAPF32[($7_1 + $8_1 | 0) >> 2] = Math_fround(HEAPF32[((HEAP32[($3_1 + $7_1 | 0) >> 2] | 0) + ($11_1 << 2 | 0) | 0) >> 2]);
        $7_1 = $7_1 + 4 | 0;
        $6_1 = $6_1 - 1 | 0;
        if ($6_1) {
         continue label1
        }
        break label1;
       };
      }
      $8_1 = $8_1 + $9_1 | 0;
      $11_1 = $11_1 + 1 | 0;
      if (($11_1 | 0) != ($4_1 | 0)) {
       continue label2
      }
      break label2;
     };
     break block3;
    case 0:
     $6_1 = $4_1 << 2 | 0;
     if (!$6_1) {
      break block3
     }
     $41($1_1 | 0, HEAP32[$3_1 >> 2] | 0 | 0, $6_1 | 0);
     break block3;
    case 1:
     break block1;
    };
   }
   if (!$4_1) {
    break block3
   }
   $10_1 = HEAP32[($3_1 + 4 | 0) >> 2] | 0;
   $3_1 = HEAP32[$3_1 >> 2] | 0;
   if (($4_1 | 0) != (1 | 0)) {
    scratch = $4_1 & 1 | 0;
    $14_1 = $4_1 & -2 | 0;
    $6_1 = $3_1;
    $7_1 = $1_1;
    $8_1 = $10_1;
    label3 : while (1) {
     HEAPF32[$7_1 >> 2] = Math_fround(HEAPF32[$6_1 >> 2]);
     HEAPF32[($7_1 + 4 | 0) >> 2] = Math_fround(HEAPF32[$8_1 >> 2]);
     HEAPF32[($7_1 + 8 | 0) >> 2] = Math_fround(HEAPF32[($6_1 + 4 | 0) >> 2]);
     HEAPF32[($7_1 + 12 | 0) >> 2] = Math_fround(HEAPF32[($8_1 + 4 | 0) >> 2]);
     $6_1 = $6_1 + 8 | 0;
     $7_1 = $7_1 + 16 | 0;
     $8_1 = $8_1 + 8 | 0;
     $9_1 = $9_1 + 2 | 0;
     if (($14_1 | 0) != ($9_1 | 0)) {
      continue label3
     }
     break label3;
    };
    if (!scratch) {
     break block3
    }
   }
   $8_1 = $1_1 + ($9_1 << 3 | 0) | 0;
   $6_1 = $9_1 << 2 | 0;
   HEAPF32[$8_1 >> 2] = Math_fround(HEAPF32[($3_1 + $6_1 | 0) >> 2]);
   HEAPF32[($8_1 + 4 | 0) >> 2] = Math_fround(HEAPF32[($6_1 + $10_1 | 0) >> 2]);
  }
  HEAP32[$2_1 >> 2] = $1_1 + (Math_imul($4_1, $5_1) << 2 | 0) | 0;
  return 0 | 0;
 }
 
 function $8($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $3_1 = 0, $4_1 = 0, $5_1 = 0, $6_1 = 0, $7_1 = 0, $72 = 0, $14_1 = 0;
  block1 : {
   $0_1 = HEAP32[($0_1 + 48 | 0) >> 2] | 0;
   $6_1 = Math_imul(HEAP32[($0_1 + 8 | 0) >> 2] | 0, $2_1);
   $14_1 = $6_1;
   $3_1 = HEAP32[($0_1 + 16 | 0) >> 2] | 0;
   if (($3_1 | 0) == (HEAP32[($0_1 + 12 | 0) >> 2] | 0 | 0)) {
    HEAP32[($0_1 + 12 | 0) >> 2] = 0;
    HEAP32[($0_1 + 16 | 0) >> 2] = 0;
    $3_1 = 0;
   }
   $4_1 = $14_1 + $3_1 | 0;
   $5_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
   if ($4_1 >>> 0 > $5_1 >>> 0) {
    label : while (1) {
     $4_1 = HEAP32[$0_1 >> 2] | 0;
     block : {
      $7_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
      if ($7_1 >>> 0 >= 32769 >>> 0) {
       $3_1 = $3_1 - $7_1 | 0;
       if ($3_1) {
        $41($4_1 | 0, $4_1 + $7_1 | 0 | 0, $3_1 | 0)
       }
       $3_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
       HEAP32[($0_1 + 12 | 0) >> 2] = 0;
       $3_1 = (HEAP32[($0_1 + 16 | 0) >> 2] | 0) - $3_1 | 0;
       HEAP32[($0_1 + 16 | 0) >> 2] = $3_1;
       $5_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
       break block;
      }
      $3_1 = $9($4_1 | 0, $5_1 + $6_1 | 0 | 0) | 0;
      HEAP32[$0_1 >> 2] = $3_1;
      $5_1 = (HEAP32[($0_1 + 4 | 0) >> 2] | 0) + $6_1 | 0;
      HEAP32[($0_1 + 4 | 0) >> 2] = $5_1;
      $72 = 0;
      if (!$3_1) {
       break block1
      }
      $3_1 = HEAP32[($0_1 + 16 | 0) >> 2] | 0;
     }
     $4_1 = $3_1 + $6_1 | 0;
     if ($4_1 >>> 0 > $5_1 >>> 0) {
      continue label
     }
     break label;
    }
   }
   HEAP32[($0_1 + 16 | 0) >> 2] = $4_1;
   $72 = (HEAP32[$0_1 >> 2] | 0) + $3_1 | 0;
  }
  $3_1 = $72;
  block2 : {
   if (!$1_1) {
    break block2
   }
   $0_1 = Math_imul(HEAP32[($0_1 + 8 | 0) >> 2] | 0, $2_1);
   if (!$0_1) {
    break block2
   }
   $41($3_1 | 0, $1_1 | 0, $0_1 | 0);
  }
  return $3_1 | 0;
 }
 
 function $9($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var $2_1 = 0, $3_1 = 0, $4_1 = 0, $5_1 = 0, $6_1 = 0, $7_1 = 0, $8_1 = 0, $9_1 = 0, $11_1 = 0, $10_1 = 0, $12_1 = 0, $208 = 0;
  if (!$0_1) {
   return $36($1_1 | 0) | 0 | 0
  }
  block2 : {
   block4 : {
    block5 : {
     block6 : {
      block : {
       if ($1_1 >>> 0 > -65 >>> 0) {
        break block
       }
       $4_1 = $1_1 >>> 0 < 11 >>> 0 ? 16 : ($1_1 + 19 | 0) & -16 | 0;
       $7_1 = $0_1 - 4 | 0;
       $8_1 = HEAP32[$7_1 >> 2] | 0;
       $3_1 = $8_1 & -8 | 0;
       block1 : {
        if (!($8_1 & 3 | 0)) {
         if ($4_1 >>> 0 < 256 >>> 0) {
          break block1
         }
         if ($3_1 >>> 0 <= $4_1 >>> 0) {
          break block1
         }
         if (($3_1 - $4_1 | 0) >>> 0 > ((HEAP32[291324 >> 2] | 0) << 1 | 0) >>> 0) {
          break block1
         }
         break block2;
        }
        $6_1 = $0_1 - 8 | 0;
        $5_1 = $6_1 + $3_1 | 0;
        if ($3_1 >>> 0 >= $4_1 >>> 0) {
         $1_1 = $3_1 - $4_1 | 0;
         if ($1_1 >>> 0 < 16 >>> 0) {
          break block2
         }
         HEAP32[$7_1 >> 2] = $4_1 | ($8_1 & 1 | 0) | 0 | 2 | 0;
         $2_1 = $4_1 + $6_1 | 0;
         HEAP32[($2_1 + 4 | 0) >> 2] = $1_1 | 3 | 0;
         HEAP32[($5_1 + 4 | 0) >> 2] = HEAP32[($5_1 + 4 | 0) >> 2] | 0 | 1 | 0;
         $40($2_1 | 0, $1_1 | 0);
         break block2;
        }
        if ((HEAP32[290868 >> 2] | 0 | 0) == ($5_1 | 0)) {
         $3_1 = (HEAP32[290856 >> 2] | 0) + $3_1 | 0;
         if ($3_1 >>> 0 <= $4_1 >>> 0) {
          break block1
         }
         HEAP32[$7_1 >> 2] = $4_1 | ($8_1 & 1 | 0) | 0 | 2 | 0;
         $1_1 = $4_1 + $6_1 | 0;
         HEAP32[290868 >> 2] = $1_1;
         $2_1 = $3_1 - $4_1 | 0;
         HEAP32[290856 >> 2] = $2_1;
         HEAP32[($1_1 + 4 | 0) >> 2] = $2_1 | 1 | 0;
         break block2;
        }
        if ((HEAP32[290864 >> 2] | 0 | 0) == ($5_1 | 0)) {
         $3_1 = (HEAP32[290852 >> 2] | 0) + $3_1 | 0;
         if ($3_1 >>> 0 < $4_1 >>> 0) {
          break block1
         }
         block3 : {
          $1_1 = $3_1 - $4_1 | 0;
          if ($1_1 >>> 0 >= 16 >>> 0) {
           HEAP32[$7_1 >> 2] = $4_1 | ($8_1 & 1 | 0) | 0 | 2 | 0;
           $2_1 = $4_1 + $6_1 | 0;
           HEAP32[($2_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
           $3_1 = $3_1 + $6_1 | 0;
           HEAP32[$3_1 >> 2] = $1_1;
           HEAP32[($3_1 + 4 | 0) >> 2] = (HEAP32[($3_1 + 4 | 0) >> 2] | 0) & -2 | 0;
           break block3;
          }
          HEAP32[$7_1 >> 2] = $8_1 & 1 | 0 | $3_1 | 0 | 2 | 0;
          $1_1 = $3_1 + $6_1 | 0;
          HEAP32[($1_1 + 4 | 0) >> 2] = HEAP32[($1_1 + 4 | 0) >> 2] | 0 | 1 | 0;
          $1_1 = 0;
         }
         HEAP32[290864 >> 2] = $2_1;
         HEAP32[290852 >> 2] = $1_1;
         break block2;
        }
        $9_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
        if ($9_1 & 2 | 0) {
         break block1
        }
        $11_1 = ($9_1 & -8 | 0) + $3_1 | 0;
        if ($11_1 >>> 0 < $4_1 >>> 0) {
         break block1
        }
        $12_1 = $11_1 - $4_1 | 0;
        $1_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
        if ($9_1 >>> 0 <= 255 >>> 0) {
         $2_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
         if (($2_1 | 0) == ($1_1 | 0)) {
          HEAP32[290844 >> 2] = (HEAP32[290844 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $9_1 >>> 3 | 0 | 0) | 0) | 0;
          break block4;
         }
         HEAP32[($1_1 + 8 | 0) >> 2] = $2_1;
         HEAP32[($2_1 + 12 | 0) >> 2] = $1_1;
         break block4;
        }
        $10_1 = HEAP32[($5_1 + 24 | 0) >> 2] | 0;
        if (($1_1 | 0) != ($5_1 | 0)) {
         $2_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
         HEAP32[($2_1 + 12 | 0) >> 2] = $1_1;
         HEAP32[($1_1 + 8 | 0) >> 2] = $2_1;
         break block5;
        }
        $2_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
        if ($2_1) {
         $208 = $5_1 + 20 | 0
        } else {
         $2_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
         if (!$2_1) {
          break block6
         }
         $208 = $5_1 + 16 | 0;
        }
        $3_1 = $208;
        label : while (1) {
         $9_1 = $3_1;
         $1_1 = $2_1;
         $3_1 = $1_1 + 20 | 0;
         $2_1 = HEAP32[($1_1 + 20 | 0) >> 2] | 0;
         if ($2_1) {
          continue label
         }
         $3_1 = $1_1 + 16 | 0;
         $2_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
         if ($2_1) {
          continue label
         }
         break label;
        };
        HEAP32[$9_1 >> 2] = 0;
        break block5;
       }
       $3_1 = $36($1_1 | 0) | 0;
       if (!$3_1) {
        break block
       }
       $2_1 = HEAP32[$7_1 >> 2] | 0;
       $2_1 = ($2_1 & 3 | 0 ? -4 : -8) + ($2_1 & -8 | 0) | 0;
       $1_1 = $1_1 >>> 0 > $2_1 >>> 0 ? $2_1 : $1_1;
       if ($1_1) {
        $41($3_1 | 0, $0_1 | 0, $1_1 | 0)
       }
       $37($0_1 | 0);
       $2_1 = $3_1;
      }
      return $2_1 | 0;
     }
     $1_1 = 0;
    }
    if (!$10_1) {
     break block4
    }
    block7 : {
     $2_1 = HEAP32[($5_1 + 28 | 0) >> 2] | 0;
     $3_1 = $2_1 << 2 | 0;
     if ((HEAP32[($3_1 + 291148 | 0) >> 2] | 0 | 0) == ($5_1 | 0)) {
      HEAP32[($3_1 + 291148 | 0) >> 2] = $1_1;
      if ($1_1) {
       break block7
      }
      HEAP32[290848 >> 2] = (HEAP32[290848 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $2_1 | 0) | 0) | 0;
      break block4;
     }
     block8 : {
      if (($5_1 | 0) == (HEAP32[($10_1 + 16 | 0) >> 2] | 0 | 0)) {
       HEAP32[($10_1 + 16 | 0) >> 2] = $1_1;
       break block8;
      }
      HEAP32[($10_1 + 20 | 0) >> 2] = $1_1;
     }
     if (!$1_1) {
      break block4
     }
    }
    HEAP32[($1_1 + 24 | 0) >> 2] = $10_1;
    $2_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
    if ($2_1) {
     HEAP32[($1_1 + 16 | 0) >> 2] = $2_1;
     HEAP32[($2_1 + 24 | 0) >> 2] = $1_1;
    }
    $2_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
    if (!$2_1) {
     break block4
    }
    HEAP32[($1_1 + 20 | 0) >> 2] = $2_1;
    HEAP32[($2_1 + 24 | 0) >> 2] = $1_1;
   }
   if ($12_1 >>> 0 <= 15 >>> 0) {
    HEAP32[$7_1 >> 2] = $8_1 & 1 | 0 | $11_1 | 0 | 2 | 0;
    $1_1 = $6_1 + $11_1 | 0;
    HEAP32[($1_1 + 4 | 0) >> 2] = HEAP32[($1_1 + 4 | 0) >> 2] | 0 | 1 | 0;
    break block2;
   }
   HEAP32[$7_1 >> 2] = $4_1 | ($8_1 & 1 | 0) | 0 | 2 | 0;
   $1_1 = $4_1 + $6_1 | 0;
   HEAP32[($1_1 + 4 | 0) >> 2] = $12_1 | 3 | 0;
   $2_1 = $6_1 + $11_1 | 0;
   HEAP32[($2_1 + 4 | 0) >> 2] = HEAP32[($2_1 + 4 | 0) >> 2] | 0 | 1 | 0;
   $40($1_1 | 0, $12_1 | 0);
   return $0_1 | 0;
  }
  return $0_1 | 0;
 }
 
 function $10($3_1, $4_1) {
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  var i64toi32_i32$1 = 0, i64toi32_i32$0 = 0, $5_1 = 0, i64toi32_i32$5 = 0, i64toi32_i32$6 = 0, $6_1 = 0, i64toi32_i32$4 = 0, i64toi32_i32$3 = 0, $7_1 = 0, $8_1 = 0, $26_1 = Math_fround(0), $23$hi = 0, $23_1 = 0, $9_1 = 0, $11_1 = 0, $10_1 = 0, $24$hi = 0, $12_1 = 0, $27_1 = Math_fround(0), $24_1 = 0, $13_1 = 0, $28_1 = Math_fround(0), $25$hi = 0, $30_1 = 0.0, i64toi32_i32$2 = 0.0, $29_1 = Math_fround(0), $25_1 = 0, $15_1 = 0, $14_1 = 0, $17_1 = 0, $18_1 = 0, $19_1 = 0, $31_1 = 0.0, $20_1 = 0, $16_1 = 0, $488 = 0, $167 = 0, $21_1 = 0, $1077 = 0, $48 = 0, $118 = 0, $119 = 0, $100 = 0, $100$hi = 0, $281 = 0, $22_1 = 0, $120 = 0, $121 = 0, $397 = 0, $397$hi = 0, $122 = 0, $123 = 0, $410 = 0, $410$hi = 0, $435 = 0, $532 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $130 = 0, $1211 = 0, $1211$hi = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $140 = 0, $1735 = 0, $90 = 0, scratch = 0, scratch_30 = 0, scratch_31 = 0, $257 = 0, $386 = 0, $399 = 0, $466 = 0, $469 = 0, $472 = 0, $475 = 0, $494 = 0, $497 = 0, $500 = 0, $503 = 0, $721 = 0, $726 = 0, $726$hi = 0, $729 = 0, $732 = 0, $732$hi = 0, $761 = Math_fround(0), $770 = Math_fround(0), $780 = Math_fround(0), $790 = Math_fround(0), $800 = Math_fround(0), $810 = Math_fround(0), $820 = Math_fround(0), $830 = Math_fround(0), $840 = Math_fround(0), $850 = Math_fround(0), $860 = Math_fround(0), $870 = Math_fround(0), $880 = Math_fround(0), $982 = 0, $1006 = 0, $1014 = 0, $1016$hi = 0, $1179 = 0, $1183 = 0, $1183$hi = 0, $1186$hi = 0, $1187$hi = 0, $1189 = 0, $1203$hi = 0, $1213$hi = 0, $1282 = 0, $1291 = 0, $1310 = 0, $1324 = 0, $1326$hi = 0, $1366 = 0, $1393 = 0, $1407 = 0, $1409$hi = 0, $1451 = 0, $1482 = 0, $1496 = 0, $1498$hi = 0, $1544 = 0, $1571 = 0, $1585 = 0, $1587$hi = 0;
  $18_1 = global$0 - 512 | 0;
  global$0 = $18_1;
  $31_1 = +HEAPF64[($3_1 + 40 | 0) >> 3];
  if ($31_1 != 0.0) {
   $6_1 = -1;
   $30_1 = Math_floor(+$11(+$31_1) / .6931471805599453);
   if (Math_abs($30_1) < 2147483647.0) {
    $48 = ~~$30_1
   } else {
    $48 = -2147483648
   }
   $5_1 = $48;
   if (($5_1 | 0) >= (0 | 0)) {
    $6_1 = (HEAP32[$3_1 >> 2] | 0) - 1 | 0;
    $6_1 = ($5_1 | 0) < ($6_1 | 0) ? $5_1 : $6_1;
   }
   HEAP32[($3_1 + 172 | 0) >> 2] = 0;
   HEAP32[($3_1 + 176 | 0) >> 2] = $6_1;
   $7_1 = ($6_1 | 0) >= (0 | 0);
   HEAP8[($3_1 + 180 | 0) >> 0] = $7_1;
   $5_1 = (HEAP32[($3_1 + 48 | 0) >> 2] | 0) + Math_imul($6_1, 48) | 0;
   $30_1 = +HEAPF64[($5_1 + 24 | 0) >> 3];
   HEAPF64[($3_1 + 184 | 0) >> 3] = $30_1;
   HEAP32[($3_1 + 168 | 0) >> 2] = ((HEAP32[$5_1 >> 2] | 0) + (HEAP32[($5_1 + 12 | 0) >> 2] | 0) | 0) + 960 | 0;
   if ($7_1) {
    $30_1 = $30_1 * .5;
    HEAPF64[($3_1 + 184 | 0) >> 3] = $30_1;
   }
   i64toi32_i32$1 = $3_1;
   i64toi32_i32$0 = 0;
   HEAP32[($3_1 + 40 | 0) >> 2] = 0;
   HEAP32[($3_1 + 44 | 0) >> 2] = i64toi32_i32$0;
   $90 = $3_1;
   $30_1 = $31_1 * $30_1 + .5;
   if (Math_abs($30_1) < 9223372036854775808.0) {
    i64toi32_i32$2 = $30_1;
    if (Math_abs(i64toi32_i32$2) >= 1.0) {
     if (i64toi32_i32$2 > 0.0) {
      $118 = ~~Math_min(Math_floor(i64toi32_i32$2 / 4294967296.0), 4294967296.0 - 1.0) >>> 0
     } else {
      $118 = ~~Math_ceil((i64toi32_i32$2 - +(~~i64toi32_i32$2 >>> 0 >>> 0)) / 4294967296.0) >>> 0
     }
     $119 = $118;
    } else {
     $119 = 0
    }
    i64toi32_i32$0 = $119;
    $100 = ~~i64toi32_i32$2 >>> 0;
    $100$hi = i64toi32_i32$0;
   } else {
    i64toi32_i32$0 = -2147483648;
    $100 = 0;
    $100$hi = i64toi32_i32$0;
   }
   i64toi32_i32$0 = $100$hi;
   $23_1 = $100;
   $23$hi = i64toi32_i32$0;
   i64toi32_i32$1 = $90;
   HEAP32[(i64toi32_i32$1 + 152 | 0) >> 2] = $23_1;
   HEAP32[(i64toi32_i32$1 + 156 | 0) >> 2] = i64toi32_i32$0;
   HEAP32[($3_1 + 144 | 0) >> 2] = $23_1 >>> 1 | 0;
  }
  $5_1 = Math_imul(HEAP32[($3_1 + 60 | 0) >> 2] | 0, $4_1);
  block1 : {
   $6_1 = HEAP32[($3_1 + 68 | 0) >> 2] | 0;
   if (($6_1 | 0) == (HEAP32[($3_1 + 64 | 0) >> 2] | 0 | 0)) {
    i64toi32_i32$1 = $3_1;
    i64toi32_i32$0 = 0;
    HEAP32[($3_1 + 64 | 0) >> 2] = 0;
    HEAP32[($3_1 + 68 | 0) >> 2] = i64toi32_i32$0;
    $6_1 = 0;
   }
   $8_1 = $5_1 + $6_1 | 0;
   $7_1 = HEAP32[($3_1 + 56 | 0) >> 2] | 0;
   if ($8_1 >>> 0 > $7_1 >>> 0) {
    label : while (1) {
     $12_1 = HEAP32[($3_1 + 52 | 0) >> 2] | 0;
     block : {
      $10_1 = HEAP32[($3_1 + 64 | 0) >> 2] | 0;
      if ($10_1 >>> 0 >= 32769 >>> 0) {
       $6_1 = $6_1 - $10_1 | 0;
       if ($6_1) {
        $41($12_1 | 0, $10_1 + $12_1 | 0 | 0, $6_1 | 0)
       }
       $6_1 = HEAP32[($3_1 + 64 | 0) >> 2] | 0;
       HEAP32[($3_1 + 64 | 0) >> 2] = 0;
       $6_1 = (HEAP32[($3_1 + 68 | 0) >> 2] | 0) - $6_1 | 0;
       HEAP32[($3_1 + 68 | 0) >> 2] = $6_1;
       $7_1 = HEAP32[($3_1 + 56 | 0) >> 2] | 0;
       break block;
      }
      $6_1 = $9($12_1 | 0, $5_1 + $7_1 | 0 | 0) | 0;
      HEAP32[($3_1 + 52 | 0) >> 2] = $6_1;
      $7_1 = (HEAP32[($3_1 + 56 | 0) >> 2] | 0) + $5_1 | 0;
      HEAP32[($3_1 + 56 | 0) >> 2] = $7_1;
      $167 = 0;
      if (!$6_1) {
       break block1
      }
      $6_1 = HEAP32[($3_1 + 68 | 0) >> 2] | 0;
     }
     $8_1 = $5_1 + $6_1 | 0;
     if ($8_1 >>> 0 > $7_1 >>> 0) {
      continue label
     }
     break label;
    }
   }
   HEAP32[($3_1 + 68 | 0) >> 2] = $8_1;
   $167 = (HEAP32[($3_1 + 52 | 0) >> 2] | 0) + $6_1 | 0;
  }
  $21_1 = $167;
  $13_1 = HEAP32[($3_1 + 176 | 0) >> 2] | 0;
  block2 : {
   if (!(HEAP32[($3_1 + 12 | 0) >> 2] | 0)) {
    $10_1 = $13_1;
    break block2;
   }
   $5_1 = HEAP32[($3_1 + 224 | 0) >> 2] | 0;
   $10_1 = ($5_1 | 0) < ($13_1 | 0) ? $13_1 : $5_1;
   $13_1 = ($5_1 | 0) > ($13_1 | 0) ? $13_1 : $5_1;
  }
  block3 : {
   $6_1 = $13_1 & ($13_1 >> 31 | 0) | 0;
   if (($6_1 | 0) > ($10_1 | 0)) {
    break block3
   }
   if (($10_1 | 0) > (0 | 0)) {
    label1 : while (1) {
     if ($6_1) {
      scratch = $12($3_1 | 0, $6_1 | 0, $6_1 >> 31 | 0 | 1 | 0 | 0, $13_1 | 0) | 0;
      if (($6_1 | 0) >= ($10_1 | 0)) {
       break block3
      }
      if (!scratch) {
       break block3
      }
     }
     $6_1 = $6_1 + 1 | 0;
     continue label1;
    }
   }
   if (($13_1 | 0) >= (0 | 0)) {
    break block3
   }
   label2 : while (1) {
    scratch_30 = $12($3_1 | 0, $6_1 | 0, $6_1 >> 31 | 0 | 1 | 0 | 0, $13_1 | 0) | 0;
    if (($6_1 | 0) >= ($10_1 | 0)) {
     break block3
    }
    if (!scratch_30) {
     break block3
    }
    scratch_31 = ($6_1 | 0) != (-1 | 0);
    $6_1 = $6_1 + 1 | 0;
    if (scratch_31) {
     continue label2
    }
    break label2;
   };
  }
  if ((HEAP32[($3_1 + 8 | 0) >> 2] | 0 | 0) > (0 | 0)) {
   HEAP32[($3_1 + 8 | 0) >> 2] = -1
  }
  $257 = $3_1;
  block4 : {
   if (($10_1 | 0) > (0 | 0)) {
    $7_1 = HEAP32[($3_1 + 48 | 0) >> 2] | 0;
    $5_1 = $7_1 + Math_imul($10_1, 48) | 0;
    $5_1 = (((HEAP32[($5_1 + 16 | 0) >> 2] | 0) - (HEAP32[($5_1 + 12 | 0) >> 2] | 0) | 0) >>> 0) / ((HEAP32[($5_1 + 8 | 0) >> 2] | 0) >>> 0) | 0;
    $281 = ((($5_1 | 0) <= (480 | 0) ? 480 : $5_1) - 480 | 0) << $10_1 | 0;
    break block4;
   }
   $7_1 = HEAP32[($3_1 + 48 | 0) >> 2] | 0;
   $5_1 = $7_1 + Math_imul($10_1, 48) | 0;
   $5_1 = (((HEAP32[($5_1 + 16 | 0) >> 2] | 0) - (HEAP32[($5_1 + 12 | 0) >> 2] | 0) | 0) >>> 0) / ((HEAP32[($5_1 + 8 | 0) >> 2] | 0) >>> 0) | 0;
   $281 = ((($5_1 | 0) <= (480 | 0) ? 480 : $5_1) - 480 | 0) >>> (0 - $10_1 | 0) | 0;
  }
  $20_1 = $281;
  $5_1 = HEAP32[($3_1 + 176 | 0) >> 2] | 0;
  HEAP32[($257 + 172 | 0) >> 2] = ($5_1 | 0) < (0 | 0) ? $20_1 << (0 - $5_1 | 0) | 0 : $20_1 >> $5_1 | 0;
  $5_1 = $7_1 + Math_imul($5_1, 48) | 0;
  HEAP32[($3_1 + 168 | 0) >> 2] = ((HEAP32[$5_1 >> 2] | 0) + (HEAP32[($5_1 + 12 | 0) >> 2] | 0) | 0) + 960 | 0;
  if (HEAP32[($3_1 + 12 | 0) >> 2] | 0) {
   $5_1 = HEAP32[($3_1 + 224 | 0) >> 2] | 0;
   HEAP32[($3_1 + 220 | 0) >> 2] = ($5_1 | 0) < (0 | 0) ? $20_1 << (0 - $5_1 | 0) | 0 : $20_1 >> $5_1 | 0;
   $5_1 = $7_1 + Math_imul($5_1, 48) | 0;
   HEAP32[($3_1 + 216 | 0) >> 2] = ((HEAP32[$5_1 >> 2] | 0) + (HEAP32[($5_1 + 12 | 0) >> 2] | 0) | 0) + 960 | 0;
  }
  $16_1 = $3_1 + 144 | 0;
  $14_1 = $3_1 + 192 | 0;
  $22_1 = $3_1 + 72 | 0;
  label11 : while (1) {
   if (($4_1 | 0) > ($19_1 | 0)) {
    $5_1 = $4_1 - $19_1 | 0;
    $12_1 = ($5_1 | 0) >= (64 | 0) ? 64 : $5_1;
    block5 : {
     $5_1 = HEAP32[($3_1 + 16 | 0) >> 2] | 0;
     if ($5_1) {
      $12_1 = ($5_1 | 0) > ($12_1 | 0) ? $12_1 : $5_1;
      break block5;
     }
     $30_1 = +HEAPF64[($3_1 + 32 | 0) >> 3];
     if ($30_1 == 0.0) {
      break block5
     }
     i64toi32_i32$1 = $3_1;
     i64toi32_i32$0 = 0;
     HEAP32[($3_1 + 208 | 0) >> 2] = 0;
     HEAP32[($3_1 + 212 | 0) >> 2] = i64toi32_i32$0;
     i64toi32_i32$1 = $3_1;
     i64toi32_i32$0 = 0;
     HEAP32[($3_1 + 160 | 0) >> 2] = 0;
     HEAP32[($3_1 + 164 | 0) >> 2] = i64toi32_i32$0;
     i64toi32_i32$1 = $3_1;
     i64toi32_i32$0 = 0;
     HEAP32[($3_1 + 32 | 0) >> 2] = 0;
     HEAP32[($3_1 + 36 | 0) >> 2] = i64toi32_i32$0;
     $386 = $3_1;
     $31_1 = $30_1 * +HEAPF64[($3_1 + 184 | 0) >> 3] + .5;
     if (Math_abs($31_1) < 9223372036854775808.0) {
      i64toi32_i32$2 = $31_1;
      if (Math_abs(i64toi32_i32$2) >= 1.0) {
       if (i64toi32_i32$2 > 0.0) {
        $120 = ~~Math_min(Math_floor(i64toi32_i32$2 / 4294967296.0), 4294967296.0 - 1.0) >>> 0
       } else {
        $120 = ~~Math_ceil((i64toi32_i32$2 - +(~~i64toi32_i32$2 >>> 0 >>> 0)) / 4294967296.0) >>> 0
       }
       $121 = $120;
      } else {
       $121 = 0
      }
      i64toi32_i32$0 = $121;
      $397 = ~~i64toi32_i32$2 >>> 0;
      $397$hi = i64toi32_i32$0;
     } else {
      i64toi32_i32$0 = -2147483648;
      $397 = 0;
      $397$hi = i64toi32_i32$0;
     }
     i64toi32_i32$0 = $397$hi;
     i64toi32_i32$1 = $386;
     HEAP32[(i64toi32_i32$1 + 152 | 0) >> 2] = $397;
     HEAP32[(i64toi32_i32$1 + 156 | 0) >> 2] = i64toi32_i32$0;
     $399 = $3_1;
     $30_1 = $30_1 * +HEAPF64[($3_1 + 232 | 0) >> 3] + .5;
     if (Math_abs($30_1) < 9223372036854775808.0) {
      i64toi32_i32$2 = $30_1;
      if (Math_abs(i64toi32_i32$2) >= 1.0) {
       if (i64toi32_i32$2 > 0.0) {
        $122 = ~~Math_min(Math_floor(i64toi32_i32$2 / 4294967296.0), 4294967296.0 - 1.0) >>> 0
       } else {
        $122 = ~~Math_ceil((i64toi32_i32$2 - +(~~i64toi32_i32$2 >>> 0 >>> 0)) / 4294967296.0) >>> 0
       }
       $123 = $122;
      } else {
       $123 = 0
      }
      i64toi32_i32$0 = $123;
      $410 = ~~i64toi32_i32$2 >>> 0;
      $410$hi = i64toi32_i32$0;
     } else {
      i64toi32_i32$0 = -2147483648;
      $410 = 0;
      $410$hi = i64toi32_i32$0;
     }
     i64toi32_i32$0 = $410$hi;
     i64toi32_i32$1 = $399;
     HEAP32[(i64toi32_i32$1 + 200 | 0) >> 2] = $410;
     HEAP32[(i64toi32_i32$1 + 204 | 0) >> 2] = i64toi32_i32$0;
    }
    $6_1 = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
    block17 : {
     block6 : {
      block13 : {
       block22 : {
        block15 : {
         block19 : {
          block8 : {
           block14 : {
            block11 : {
             block7 : {
              if (!(HEAP32[($3_1 + 8 | 0) >> 2] | 0)) {
               if ($6_1) {
                $7_1 = HEAPU8[($3_1 + 180 | 0) >> 0] | 0;
                break block6;
               }
               $6_1 = HEAPU8[($3_1 + 180 | 0) >> 0] | 0;
               if (HEAP32[($3_1 + 20 | 0) >> 2] | 0) {
                break block7
               }
               $5_1 = HEAP32[($3_1 + 156 | 0) >> 2] | 0;
               block12 : {
                block10 : {
                 if ($6_1 & 1 | 0) {
                  $6_1 = HEAP32[($3_1 + 152 | 0) >> 2] | 0;
                  block9 : {
                   if ($5_1) {
                    if (!$6_1) {
                     break block8
                    }
                    $10_1 = $10_1 + 1 | 0;
                    $435 = 1;
                    break block9;
                   }
                   if (($6_1 | 0) < (0 | 0)) {
                    break block8
                   }
                   $13_1 = $13_1 - 1 | 0;
                   $435 = -1;
                  }
                  $11_1 = $435;
                  $6_1 = $11_1 + (HEAP32[($3_1 + 176 | 0) >> 2] | 0) | 0;
                  if (($6_1 | 0) < (HEAP32[($3_1 + 4 | 0) >> 2] | 0 | 0)) {
                   break block10
                  }
                  $10_1 = $10_1 - 1 | 0;
                  break block8;
                 }
                 if (($5_1 | 0) < (2 | 0)) {
                  break block11
                 }
                 if (!(HEAP32[($3_1 + 152 | 0) >> 2] | 0)) {
                  break block11
                 }
                 $6_1 = (HEAP32[($3_1 + 176 | 0) >> 2] | 0) + 1 | 0;
                 if (($6_1 | 0) >= (HEAP32[($3_1 + 4 | 0) >> 2] | 0 | 0)) {
                  break block11
                 }
                 HEAP32[($3_1 + 24 | 0) >> 2] = 1;
                 i64toi32_i32$3 = $16_1;
                 i64toi32_i32$0 = HEAP32[i64toi32_i32$3 >> 2] | 0;
                 i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 4 | 0) >> 2] | 0;
                 $466 = i64toi32_i32$0;
                 i64toi32_i32$0 = $14_1;
                 HEAP32[i64toi32_i32$0 >> 2] = $466;
                 HEAP32[(i64toi32_i32$0 + 4 | 0) >> 2] = i64toi32_i32$1;
                 i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 8 | 0) >> 2] | 0;
                 i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 12 | 0) >> 2] | 0;
                 $469 = i64toi32_i32$1;
                 i64toi32_i32$1 = $14_1;
                 HEAP32[(i64toi32_i32$1 + 8 | 0) >> 2] = $469;
                 HEAP32[(i64toi32_i32$1 + 12 | 0) >> 2] = i64toi32_i32$0;
                 i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 16 | 0) >> 2] | 0;
                 i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 20 | 0) >> 2] | 0;
                 $472 = i64toi32_i32$0;
                 i64toi32_i32$0 = $14_1;
                 HEAP32[(i64toi32_i32$0 + 16 | 0) >> 2] = $472;
                 HEAP32[(i64toi32_i32$0 + 20 | 0) >> 2] = i64toi32_i32$1;
                 i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 24 | 0) >> 2] | 0;
                 i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 28 | 0) >> 2] | 0;
                 $475 = i64toi32_i32$1;
                 i64toi32_i32$1 = $14_1;
                 HEAP32[(i64toi32_i32$1 + 24 | 0) >> 2] = $475;
                 HEAP32[(i64toi32_i32$1 + 28 | 0) >> 2] = i64toi32_i32$0;
                 i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 40 | 0) >> 2] | 0;
                 i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 44 | 0) >> 2] | 0;
                 $23_1 = i64toi32_i32$0;
                 $23$hi = i64toi32_i32$1;
                 i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 32 | 0) >> 2] | 0;
                 i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 36 | 0) >> 2] | 0;
                 $24_1 = i64toi32_i32$1;
                 $24$hi = i64toi32_i32$0;
                 HEAP32[($3_1 + 176 | 0) >> 2] = $6_1;
                 i64toi32_i32$1 = $14_1;
                 HEAP32[(i64toi32_i32$1 + 32 | 0) >> 2] = $24_1;
                 HEAP32[(i64toi32_i32$1 + 36 | 0) >> 2] = i64toi32_i32$0;
                 i64toi32_i32$0 = $23$hi;
                 HEAP32[(i64toi32_i32$1 + 40 | 0) >> 2] = $23_1;
                 HEAP32[(i64toi32_i32$1 + 44 | 0) >> 2] = i64toi32_i32$0;
                 $10_1 = $10_1 + 1 | 0;
                 $15_1 = 0;
                 $11_1 = 1;
                 $488 = 1;
                 break block12;
                }
                $15_1 = 0;
                HEAP32[($3_1 + 24 | 0) >> 2] = ($5_1 | 0) != (0 | 0);
                i64toi32_i32$3 = $16_1;
                i64toi32_i32$0 = HEAP32[i64toi32_i32$3 >> 2] | 0;
                i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 4 | 0) >> 2] | 0;
                $494 = i64toi32_i32$0;
                i64toi32_i32$0 = $14_1;
                HEAP32[i64toi32_i32$0 >> 2] = $494;
                HEAP32[(i64toi32_i32$0 + 4 | 0) >> 2] = i64toi32_i32$1;
                i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 8 | 0) >> 2] | 0;
                i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 12 | 0) >> 2] | 0;
                $497 = i64toi32_i32$1;
                i64toi32_i32$1 = $14_1;
                HEAP32[(i64toi32_i32$1 + 8 | 0) >> 2] = $497;
                HEAP32[(i64toi32_i32$1 + 12 | 0) >> 2] = i64toi32_i32$0;
                i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 16 | 0) >> 2] | 0;
                i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 20 | 0) >> 2] | 0;
                $500 = i64toi32_i32$0;
                i64toi32_i32$0 = $14_1;
                HEAP32[(i64toi32_i32$0 + 16 | 0) >> 2] = $500;
                HEAP32[(i64toi32_i32$0 + 20 | 0) >> 2] = i64toi32_i32$1;
                i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 24 | 0) >> 2] | 0;
                i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 28 | 0) >> 2] | 0;
                $503 = i64toi32_i32$1;
                i64toi32_i32$1 = $14_1;
                HEAP32[(i64toi32_i32$1 + 24 | 0) >> 2] = $503;
                HEAP32[(i64toi32_i32$1 + 28 | 0) >> 2] = i64toi32_i32$0;
                i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 40 | 0) >> 2] | 0;
                i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 44 | 0) >> 2] | 0;
                $23_1 = i64toi32_i32$0;
                $23$hi = i64toi32_i32$1;
                i64toi32_i32$1 = HEAP32[(i64toi32_i32$3 + 32 | 0) >> 2] | 0;
                i64toi32_i32$0 = HEAP32[(i64toi32_i32$3 + 36 | 0) >> 2] | 0;
                $24_1 = i64toi32_i32$1;
                $24$hi = i64toi32_i32$0;
                HEAP32[($3_1 + 176 | 0) >> 2] = $6_1;
                i64toi32_i32$1 = $14_1;
                HEAP32[(i64toi32_i32$1 + 32 | 0) >> 2] = $24_1;
                HEAP32[(i64toi32_i32$1 + 36 | 0) >> 2] = i64toi32_i32$0;
                i64toi32_i32$0 = $23$hi;
                HEAP32[(i64toi32_i32$1 + 40 | 0) >> 2] = $23_1;
                HEAP32[(i64toi32_i32$1 + 44 | 0) >> 2] = i64toi32_i32$0;
                $488 = 1;
                if ($5_1) {
                 break block12
                }
                HEAP32[($3_1 + 28 | 0) >> 2] = $6_1;
                $15_1 = 1;
                $488 = 0;
               }
               $8_1 = $488;
               $5_1 = HEAP32[($3_1 + 48 | 0) >> 2] | 0;
               $532 = $5_1;
               if (!($15_1 & ($6_1 | 0) < (0 | 0) | 0 | ($8_1 & ($6_1 | 0) > (0 | 0) | 0) | 0)) {
                break block13
               }
               $9_1 = $5_1 + Math_imul($6_1, 48) | 0;
               i64toi32_i32$1 = $9_1;
               i64toi32_i32$0 = 0;
               HEAP32[(i64toi32_i32$1 + 12 | 0) >> 2] = 0;
               HEAP32[(i64toi32_i32$1 + 16 | 0) >> 2] = i64toi32_i32$0;
               $5_1 = 0;
               $6_1 = Math_imul(HEAP32[(i64toi32_i32$1 + 8 | 0) >> 2] | 0, HEAP32[(i64toi32_i32$1 + 40 | 0) >> 2] | 0);
               $8_1 = HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] | 0;
               if ($6_1 >>> 0 > $8_1 >>> 0) {
                break block14
               }
               $7_1 = $6_1;
               break block15;
              }
              $7_1 = HEAPU8[($3_1 + 180 | 0) >> 0] | 0;
              if ($6_1) {
               break block6
              }
              if (!($7_1 & 1 | 0)) {
               break block11
              }
              break block8;
             }
             if ($6_1 & 1 | 0) {
              break block8
             }
            }
            block18 : {
             if (($12_1 | 0) > (0 | 0)) {
              $11_1 = (HEAP32[($3_1 + 168 | 0) >> 2] | 0) - 20 | 0;
              $7_1 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
              $15_1 = HEAP32[($3_1 + 172 | 0) >> 2] | 0;
              $5_1 = 0;
              $8_1 = $21_1 + ($19_1 << 2 | 0) | 0;
              $9_1 = $8_1;
              block16 : {
               label3 : while (1) {
                if (($7_1 | 0) >= ($15_1 | 0)) {
                 break block16
                }
                $17_1 = HEAP32[($3_1 + 144 | 0) >> 2] | 0;
                $6_1 = Math_imul($17_1 >>> 23 | 0, 96);
                $26_1 = Math_fround(Math_fround(($17_1 << 9 | 0) >>> 0) * Math_fround(2.3283064365386963e-10));
                $7_1 = $11_1 + ($7_1 << 2 | 0) | 0;
                HEAPF32[$9_1 >> 2] = Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241768 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241772 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 44 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241760 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241764 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 40 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241752 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241756 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 36 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241744 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241748 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 32 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241736 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241740 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 28 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241728 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241732 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 24 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241720 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241724 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 20 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241712 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241716 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 16 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241704 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241708 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 12 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241696 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241700 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 8 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241688 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241692 | 0) >> 2])) * Math_fround(HEAPF32[($7_1 + 4 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($6_1 + 241680 | 0) >> 2]) * $26_1) + Math_fround(HEAPF32[($6_1 + 241684 | 0) >> 2])) * Math_fround(HEAPF32[$7_1 >> 2])) + Math_fround(0.0)))))))))))));
                $721 = $3_1;
                i64toi32_i32$3 = $3_1;
                i64toi32_i32$0 = HEAP32[($3_1 + 152 | 0) >> 2] | 0;
                i64toi32_i32$1 = HEAP32[($3_1 + 156 | 0) >> 2] | 0;
                $23_1 = i64toi32_i32$0;
                $23$hi = i64toi32_i32$1;
                i64toi32_i32$3 = $3_1;
                i64toi32_i32$1 = HEAP32[($3_1 + 144 | 0) >> 2] | 0;
                i64toi32_i32$0 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
                $726 = i64toi32_i32$1;
                $726$hi = i64toi32_i32$0;
                i64toi32_i32$0 = $23$hi;
                i64toi32_i32$3 = $23_1;
                i64toi32_i32$1 = $726$hi;
                i64toi32_i32$4 = $726;
                i64toi32_i32$5 = i64toi32_i32$3 + i64toi32_i32$4 | 0;
                i64toi32_i32$6 = i64toi32_i32$0 + i64toi32_i32$1 | 0;
                if (i64toi32_i32$5 >>> 0 < i64toi32_i32$4 >>> 0) {
                 i64toi32_i32$6 = i64toi32_i32$6 + 1 | 0
                }
                $24_1 = i64toi32_i32$5;
                $24$hi = i64toi32_i32$6;
                i64toi32_i32$3 = $721;
                HEAP32[(i64toi32_i32$3 + 144 | 0) >> 2] = i64toi32_i32$5;
                HEAP32[(i64toi32_i32$3 + 148 | 0) >> 2] = i64toi32_i32$6;
                $729 = $3_1;
                i64toi32_i32$6 = $23$hi;
                i64toi32_i32$0 = $3_1;
                i64toi32_i32$6 = HEAP32[($3_1 + 160 | 0) >> 2] | 0;
                i64toi32_i32$3 = HEAP32[($3_1 + 164 | 0) >> 2] | 0;
                $732 = i64toi32_i32$6;
                $732$hi = i64toi32_i32$3;
                i64toi32_i32$3 = $23$hi;
                i64toi32_i32$0 = $23_1;
                i64toi32_i32$6 = $732$hi;
                i64toi32_i32$4 = $732;
                i64toi32_i32$1 = i64toi32_i32$0 + i64toi32_i32$4 | 0;
                i64toi32_i32$5 = i64toi32_i32$3 + i64toi32_i32$6 | 0;
                if (i64toi32_i32$1 >>> 0 < i64toi32_i32$4 >>> 0) {
                 i64toi32_i32$5 = i64toi32_i32$5 + 1 | 0
                }
                i64toi32_i32$0 = $729;
                HEAP32[(i64toi32_i32$0 + 152 | 0) >> 2] = i64toi32_i32$1;
                HEAP32[(i64toi32_i32$0 + 156 | 0) >> 2] = i64toi32_i32$5;
                $9_1 = $9_1 + 4 | 0;
                i64toi32_i32$5 = $24$hi;
                i64toi32_i32$3 = $24_1;
                i64toi32_i32$0 = 0;
                i64toi32_i32$4 = 32;
                i64toi32_i32$6 = i64toi32_i32$4 & 31 | 0;
                if (32 >>> 0 <= (i64toi32_i32$4 & 63 | 0) >>> 0) {
                 i64toi32_i32$0 = 0;
                 $124 = i64toi32_i32$5 >>> i64toi32_i32$6 | 0;
                } else {
                 i64toi32_i32$0 = i64toi32_i32$5 >>> i64toi32_i32$6 | 0;
                 $124 = (((1 << i64toi32_i32$6 | 0) - 1 | 0) & i64toi32_i32$5 | 0) << (32 - i64toi32_i32$6 | 0) | 0 | (i64toi32_i32$3 >>> i64toi32_i32$6 | 0) | 0;
                }
                $7_1 = $124;
                $5_1 = $5_1 + 1 | 0;
                if (($12_1 | 0) != ($5_1 | 0)) {
                 continue label3
                }
                break label3;
               };
               $5_1 = $12_1;
              }
              if (!(HEAP32[$3_1 >> 2] | 0)) {
               break block17
              }
              if (($5_1 | 0) <= (0 | 0)) {
               break block18
              }
              $6_1 = $5_1;
              label4 : while (1) {
               $26_1 = Math_fround(HEAPF32[($3_1 + 72 | 0) >> 2]);
               $27_1 = Math_fround(HEAPF32[$8_1 >> 2]);
               HEAPF32[($3_1 + 72 | 0) >> 2] = $27_1;
               $28_1 = Math_fround(HEAPF32[($3_1 + 76 | 0) >> 2]);
               HEAP32[($3_1 + 76 | 0) >> 2] = 0;
               $761 = $28_1;
               $28_1 = Math_fround(HEAPF32[($3_1 + 80 | 0) >> 2]);
               $29_1 = Math_fround($761 + Math_fround(Math_fround(Math_fround(0.0) - $28_1) * Math_fround(.02628520503640175)));
               HEAPF32[($3_1 + 80 | 0) >> 2] = $29_1;
               $770 = $26_1;
               $26_1 = Math_fround(HEAPF32[($3_1 + 84 | 0) >> 2]);
               $27_1 = Math_fround($770 + Math_fround(Math_fround($27_1 - $26_1) * Math_fround(.09983104467391968)));
               HEAPF32[($3_1 + 84 | 0) >> 2] = $27_1;
               $780 = $28_1;
               $28_1 = Math_fround(HEAPF32[($3_1 + 88 | 0) >> 2]);
               $29_1 = Math_fround($780 + Math_fround(Math_fround($29_1 - $28_1) * Math_fround(.20686505734920502)));
               HEAPF32[($3_1 + 88 | 0) >> 2] = $29_1;
               $790 = $26_1;
               $26_1 = Math_fround(HEAPF32[($3_1 + 92 | 0) >> 2]);
               $27_1 = Math_fround($790 + Math_fround(Math_fround($27_1 - $26_1) * Math_fround(.3302241265773773)));
               HEAPF32[($3_1 + 92 | 0) >> 2] = $27_1;
               $800 = $28_1;
               $28_1 = Math_fround(HEAPF32[($3_1 + 96 | 0) >> 2]);
               $29_1 = Math_fround($800 + Math_fround(Math_fround($29_1 - $28_1) * Math_fround(.4544203579425812)));
               HEAPF32[($3_1 + 96 | 0) >> 2] = $29_1;
               $810 = $26_1;
               $26_1 = Math_fround(HEAPF32[($3_1 + 100 | 0) >> 2]);
               $27_1 = Math_fround($810 + Math_fround(Math_fround($27_1 - $26_1) * Math_fround(.5685783624649048)));
               HEAPF32[($3_1 + 100 | 0) >> 2] = $27_1;
               $820 = $28_1;
               $28_1 = Math_fround(HEAPF32[($3_1 + 104 | 0) >> 2]);
               $29_1 = Math_fround($820 + Math_fround(Math_fround($29_1 - $28_1) * Math_fround(.6669444441795349)));
               HEAPF32[($3_1 + 104 | 0) >> 2] = $29_1;
               $830 = $26_1;
               $26_1 = Math_fround(HEAPF32[($3_1 + 108 | 0) >> 2]);
               $27_1 = Math_fround($830 + Math_fround(Math_fround($27_1 - $26_1) * Math_fround(.7478697896003723)));
               HEAPF32[($3_1 + 108 | 0) >> 2] = $27_1;
               $840 = $28_1;
               $28_1 = Math_fround(HEAPF32[($3_1 + 112 | 0) >> 2]);
               $29_1 = Math_fround($840 + Math_fround(Math_fround($29_1 - $28_1) * Math_fround(.8123244047164917)));
               HEAPF32[($3_1 + 112 | 0) >> 2] = $29_1;
               $850 = $26_1;
               $26_1 = Math_fround(HEAPF32[($3_1 + 116 | 0) >> 2]);
               $27_1 = Math_fround($850 + Math_fround(Math_fround($27_1 - $26_1) * Math_fround(.8626000881195068)));
               HEAPF32[($3_1 + 116 | 0) >> 2] = $27_1;
               $860 = $28_1;
               $28_1 = Math_fround(HEAPF32[($3_1 + 120 | 0) >> 2]);
               $29_1 = Math_fround($860 + Math_fround(Math_fround($29_1 - $28_1) * Math_fround(.9014277458190918)));
               HEAPF32[($3_1 + 120 | 0) >> 2] = $29_1;
               $870 = $26_1;
               $26_1 = Math_fround(HEAPF32[($3_1 + 124 | 0) >> 2]);
               $27_1 = Math_fround($870 + Math_fround(Math_fround($27_1 - $26_1) * Math_fround(.9314860701560974)));
               HEAPF32[($3_1 + 124 | 0) >> 2] = $27_1;
               $880 = $28_1;
               $28_1 = Math_fround(HEAPF32[($3_1 + 128 | 0) >> 2]);
               $29_1 = Math_fround($880 + Math_fround(Math_fround($29_1 - $28_1) * Math_fround(.9551915526390076)));
               HEAPF32[($3_1 + 128 | 0) >> 2] = $29_1;
               $26_1 = Math_fround($26_1 + Math_fround(Math_fround($27_1 - Math_fround(HEAPF32[($3_1 + 132 | 0) >> 2])) * Math_fround(.9746617674827576)));
               HEAPF32[($3_1 + 132 | 0) >> 2] = $26_1;
               $27_1 = Math_fround($28_1 + Math_fround(Math_fround($29_1 - Math_fround(HEAPF32[($3_1 + 136 | 0) >> 2])) * Math_fround(.9917762875556946)));
               HEAPF32[($3_1 + 136 | 0) >> 2] = $27_1;
               HEAPF32[$8_1 >> 2] = Math_fround($26_1 + $27_1);
               $8_1 = $8_1 + 4 | 0;
               $6_1 = $6_1 - 1 | 0;
               if ($6_1) {
                continue label4
               }
               break label4;
              };
              break block18;
             }
             $5_1 = 0;
             if (!(HEAP32[$3_1 >> 2] | 0)) {
              break block17
             }
            }
            HEAPF32[($3_1 + 136 | 0) >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 136 | 0) >> 2]) + Math_fround(5.421010862427522e-20)) + Math_fround(-5.421010862427522e-20));
            HEAPF32[($3_1 + 128 | 0) >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 128 | 0) >> 2]) + Math_fround(5.421010862427522e-20)) + Math_fround(-5.421010862427522e-20));
            HEAPF32[($3_1 + 120 | 0) >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 120 | 0) >> 2]) + Math_fround(5.421010862427522e-20)) + Math_fround(-5.421010862427522e-20));
            HEAPF32[($3_1 + 112 | 0) >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 112 | 0) >> 2]) + Math_fround(5.421010862427522e-20)) + Math_fround(-5.421010862427522e-20));
            HEAPF32[($3_1 + 104 | 0) >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 104 | 0) >> 2]) + Math_fround(5.421010862427522e-20)) + Math_fround(-5.421010862427522e-20));
            HEAPF32[($3_1 + 96 | 0) >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 96 | 0) >> 2]) + Math_fround(5.421010862427522e-20)) + Math_fround(-5.421010862427522e-20));
            HEAPF32[($3_1 + 88 | 0) >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 88 | 0) >> 2]) + Math_fround(5.421010862427522e-20)) + Math_fround(-5.421010862427522e-20));
            HEAPF32[($3_1 + 80 | 0) >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[($3_1 + 80 | 0) >> 2]) + Math_fround(5.421010862427522e-20)) + Math_fround(-5.421010862427522e-20));
            break block17;
           }
           $7_1 = 0;
           break block19;
          }
          block20 : {
           $11_1 = $12_1 << 1 | 0;
           if (($11_1 | 0) <= (0 | 0)) {
            $5_1 = 0;
            break block20;
           }
           $8_1 = (HEAP32[($3_1 + 168 | 0) >> 2] | 0) - 36 | 0;
           $7_1 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
           $9_1 = HEAP32[($3_1 + 172 | 0) >> 2] | 0;
           $5_1 = 0;
           $6_1 = $18_1;
           label5 : while (1) {
            if (($7_1 | 0) >= ($9_1 | 0)) {
             break block20
            }
            HEAPF32[$6_1 >> 2] = Math_fround($13($8_1 + ($7_1 << 2 | 0) | 0 | 0, HEAP32[($3_1 + 144 | 0) >> 2] | 0 | 0));
            $982 = $3_1;
            i64toi32_i32$5 = $3_1;
            i64toi32_i32$0 = HEAP32[($3_1 + 144 | 0) >> 2] | 0;
            i64toi32_i32$3 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
            $25_1 = i64toi32_i32$0;
            $25$hi = i64toi32_i32$3;
            i64toi32_i32$5 = $3_1;
            i64toi32_i32$3 = HEAP32[($3_1 + 152 | 0) >> 2] | 0;
            i64toi32_i32$0 = HEAP32[($3_1 + 156 | 0) >> 2] | 0;
            $24_1 = i64toi32_i32$3;
            $24$hi = i64toi32_i32$0;
            i64toi32_i32$0 = $25$hi;
            i64toi32_i32$5 = $25_1;
            i64toi32_i32$3 = $24$hi;
            i64toi32_i32$4 = $24_1;
            i64toi32_i32$6 = i64toi32_i32$5 + i64toi32_i32$4 | 0;
            i64toi32_i32$1 = i64toi32_i32$0 + i64toi32_i32$3 | 0;
            if (i64toi32_i32$6 >>> 0 < i64toi32_i32$4 >>> 0) {
             i64toi32_i32$1 = i64toi32_i32$1 + 1 | 0
            }
            $23_1 = i64toi32_i32$6;
            $23$hi = i64toi32_i32$1;
            i64toi32_i32$5 = $982;
            HEAP32[(i64toi32_i32$5 + 144 | 0) >> 2] = i64toi32_i32$6;
            HEAP32[(i64toi32_i32$5 + 148 | 0) >> 2] = i64toi32_i32$1;
            i64toi32_i32$0 = i64toi32_i32$6;
            i64toi32_i32$5 = 0;
            i64toi32_i32$4 = 32;
            i64toi32_i32$3 = i64toi32_i32$4 & 31 | 0;
            if (32 >>> 0 <= (i64toi32_i32$4 & 63 | 0) >>> 0) {
             i64toi32_i32$5 = 0;
             $125 = i64toi32_i32$1 >>> i64toi32_i32$3 | 0;
            } else {
             i64toi32_i32$5 = i64toi32_i32$1 >>> i64toi32_i32$3 | 0;
             $125 = (((1 << i64toi32_i32$3 | 0) - 1 | 0) & i64toi32_i32$1 | 0) << (32 - i64toi32_i32$3 | 0) | 0 | (i64toi32_i32$0 >>> i64toi32_i32$3 | 0) | 0;
            }
            $7_1 = $125;
            if (($7_1 | 0) >= ($9_1 | 0)) {
             i64toi32_i32$5 = $25$hi;
             i64toi32_i32$0 = $16_1;
             HEAP32[i64toi32_i32$0 >> 2] = $25_1;
             HEAP32[(i64toi32_i32$0 + 4 | 0) >> 2] = i64toi32_i32$5;
             break block20;
            }
            i64toi32_i32$5 = $23$hi;
            $26_1 = Math_fround($13($8_1 + ($7_1 << 2 | 0) | 0 | 0, $23_1 | 0));
            $1006 = $3_1;
            i64toi32_i32$5 = $24$hi;
            i64toi32_i32$5 = $23$hi;
            i64toi32_i32$1 = $23_1;
            i64toi32_i32$0 = $24$hi;
            i64toi32_i32$4 = $24_1;
            i64toi32_i32$3 = i64toi32_i32$1 + i64toi32_i32$4 | 0;
            i64toi32_i32$6 = i64toi32_i32$5 + i64toi32_i32$0 | 0;
            if (i64toi32_i32$3 >>> 0 < i64toi32_i32$4 >>> 0) {
             i64toi32_i32$6 = i64toi32_i32$6 + 1 | 0
            }
            $23_1 = i64toi32_i32$3;
            $23$hi = i64toi32_i32$6;
            i64toi32_i32$1 = $1006;
            HEAP32[(i64toi32_i32$1 + 144 | 0) >> 2] = i64toi32_i32$3;
            HEAP32[(i64toi32_i32$1 + 148 | 0) >> 2] = i64toi32_i32$6;
            HEAPF32[($6_1 + 4 | 0) >> 2] = $26_1;
            $1014 = $3_1;
            i64toi32_i32$5 = $3_1;
            i64toi32_i32$6 = HEAP32[($3_1 + 160 | 0) >> 2] | 0;
            i64toi32_i32$1 = HEAP32[($3_1 + 164 | 0) >> 2] | 0;
            $1016$hi = i64toi32_i32$1;
            i64toi32_i32$1 = $24$hi;
            i64toi32_i32$1 = $1016$hi;
            i64toi32_i32$5 = i64toi32_i32$6;
            i64toi32_i32$6 = $24$hi;
            i64toi32_i32$4 = $24_1;
            i64toi32_i32$0 = i64toi32_i32$5 + i64toi32_i32$4 | 0;
            i64toi32_i32$3 = i64toi32_i32$1 + i64toi32_i32$6 | 0;
            if (i64toi32_i32$0 >>> 0 < i64toi32_i32$4 >>> 0) {
             i64toi32_i32$3 = i64toi32_i32$3 + 1 | 0
            }
            i64toi32_i32$5 = $1014;
            HEAP32[(i64toi32_i32$5 + 152 | 0) >> 2] = i64toi32_i32$0;
            HEAP32[(i64toi32_i32$5 + 156 | 0) >> 2] = i64toi32_i32$3;
            $6_1 = $6_1 + 8 | 0;
            i64toi32_i32$3 = $23$hi;
            i64toi32_i32$1 = $23_1;
            i64toi32_i32$5 = 0;
            i64toi32_i32$4 = 32;
            i64toi32_i32$6 = i64toi32_i32$4 & 31 | 0;
            if (32 >>> 0 <= (i64toi32_i32$4 & 63 | 0) >>> 0) {
             i64toi32_i32$5 = 0;
             $126 = i64toi32_i32$3 >>> i64toi32_i32$6 | 0;
            } else {
             i64toi32_i32$5 = i64toi32_i32$3 >>> i64toi32_i32$6 | 0;
             $126 = (((1 << i64toi32_i32$6 | 0) - 1 | 0) & i64toi32_i32$3 | 0) << (32 - i64toi32_i32$6 | 0) | 0 | (i64toi32_i32$1 >>> i64toi32_i32$6 | 0) | 0;
            }
            $7_1 = $126;
            $5_1 = $5_1 + 2 | 0;
            if (($5_1 | 0) < ($11_1 | 0)) {
             continue label5
            }
            break label5;
           };
          }
          $5_1 = $5_1 >> 1 | 0;
          $14($22_1 | 0, $21_1 + ($19_1 << 2 | 0) | 0 | 0, $18_1 | 0, $5_1 | 0);
          break block17;
         }
         label6 : while (1) {
          $17_1 = HEAP32[$9_1 >> 2] | 0;
          block21 : {
           if ($7_1 >>> 0 >= 32769 >>> 0) {
            $5_1 = $5_1 - $7_1 | 0;
            if ($5_1) {
             $41($17_1 | 0, $7_1 + $17_1 | 0 | 0, $5_1 | 0)
            }
            $5_1 = HEAP32[($9_1 + 12 | 0) >> 2] | 0;
            HEAP32[($9_1 + 12 | 0) >> 2] = 0;
            $5_1 = (HEAP32[($9_1 + 16 | 0) >> 2] | 0) - $5_1 | 0;
            HEAP32[($9_1 + 16 | 0) >> 2] = $5_1;
            $8_1 = HEAP32[($9_1 + 4 | 0) >> 2] | 0;
            break block21;
           }
           $5_1 = $9($17_1 | 0, $6_1 + $8_1 | 0 | 0) | 0;
           HEAP32[$9_1 >> 2] = $5_1;
           $8_1 = (HEAP32[($9_1 + 4 | 0) >> 2] | 0) + $6_1 | 0;
           HEAP32[($9_1 + 4 | 0) >> 2] = $8_1;
           $1077 = 0;
           if (!$5_1) {
            break block22
           }
           $5_1 = HEAP32[($9_1 + 16 | 0) >> 2] | 0;
          }
          $7_1 = $5_1 + $6_1 | 0;
          if ($7_1 >>> 0 <= $8_1 >>> 0) {
           break block15
          }
          $7_1 = HEAP32[($9_1 + 12 | 0) >> 2] | 0;
          continue label6;
         };
        }
        HEAP32[($9_1 + 16 | 0) >> 2] = $7_1;
        $1077 = (HEAP32[$9_1 >> 2] | 0) + $5_1 | 0;
       }
       $5_1 = $1077;
       $6_1 = (HEAP32[($9_1 + 40 | 0) >> 2] | 0) << 2 | 0;
       if ($6_1) {
        $42($5_1 | 0, $6_1 | 0)
       }
       HEAP32[($9_1 + 32 | 0) >> 2] = 0;
       $5_1 = HEAP32[($3_1 + 176 | 0) >> 2] | 0;
       $12($3_1 | 0, $5_1 | 0, $11_1 | 0, $5_1 | 0) | 0;
       $6_1 = HEAP32[($3_1 + 176 | 0) >> 2] | 0;
       $532 = HEAP32[($3_1 + 48 | 0) >> 2] | 0;
      }
      $5_1 = $532;
      if (!(!$15_1 | ($6_1 | 0) <= (0 | 0) | 0)) {
       $5_1 = $5_1 + Math_imul($6_1, 48) | 0;
       HEAP32[($5_1 + 16 | 0) >> 2] = (HEAP32[($5_1 + 12 | 0) >> 2] | 0) + Math_imul(HEAP32[($5_1 + 8 | 0) >> 2] | 0, (HEAP32[($3_1 + 148 | 0) >> 2] | 0) + 250 | 0) | 0;
       $12($3_1 | 0, $6_1 | 0, 1 | 0, $6_1 | 0) | 0;
       $6_1 = HEAP32[($3_1 + 176 | 0) >> 2] | 0;
       $5_1 = HEAP32[($3_1 + 48 | 0) >> 2] | 0;
      }
      $7_1 = ($6_1 | 0) >= (0 | 0);
      HEAP8[($3_1 + 180 | 0) >> 0] = $7_1;
      $8_1 = ($6_1 | 0) < (0 | 0);
      HEAP32[($3_1 + 172 | 0) >> 2] = $8_1 ? $20_1 << (0 - $6_1 | 0) | 0 : $20_1 >> $6_1 | 0;
      $5_1 = $5_1 + Math_imul($6_1, 48) | 0;
      $30_1 = +HEAPF64[($5_1 + 24 | 0) >> 3];
      HEAPF64[($3_1 + 184 | 0) >> 3] = $30_1;
      HEAP32[($3_1 + 168 | 0) >> 2] = ((HEAP32[$5_1 >> 2] | 0) + (HEAP32[($5_1 + 12 | 0) >> 2] | 0) | 0) + 960 | 0;
      if (!$8_1) {
       HEAPF64[($3_1 + 184 | 0) >> 3] = $30_1 * .5
      }
      $1179 = $3_1;
      i64toi32_i32$3 = $3_1;
      i64toi32_i32$5 = HEAP32[($3_1 + 144 | 0) >> 2] | 0;
      i64toi32_i32$1 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
      $23_1 = i64toi32_i32$5;
      $23$hi = i64toi32_i32$1;
      i64toi32_i32$3 = i64toi32_i32$5;
      i64toi32_i32$5 = 0;
      i64toi32_i32$4 = 1;
      i64toi32_i32$6 = i64toi32_i32$4 & 31 | 0;
      if (32 >>> 0 <= (i64toi32_i32$4 & 63 | 0) >>> 0) {
       i64toi32_i32$5 = i64toi32_i32$3 << i64toi32_i32$6 | 0;
       $127 = 0;
      } else {
       i64toi32_i32$5 = ((1 << i64toi32_i32$6 | 0) - 1 | 0) & (i64toi32_i32$3 >>> (32 - i64toi32_i32$6 | 0) | 0) | 0 | (i64toi32_i32$1 << i64toi32_i32$6 | 0) | 0;
       $127 = i64toi32_i32$3 << i64toi32_i32$6 | 0;
      }
      $1183 = $127;
      $1183$hi = i64toi32_i32$5;
      i64toi32_i32$5 = $23$hi;
      i64toi32_i32$5 = 0;
      $1186$hi = i64toi32_i32$5;
      i64toi32_i32$5 = $23$hi;
      i64toi32_i32$1 = $23_1;
      i64toi32_i32$3 = $1186$hi;
      i64toi32_i32$4 = $11_1;
      i64toi32_i32$6 = i64toi32_i32$4 & 31 | 0;
      if (32 >>> 0 <= (i64toi32_i32$4 & 63 | 0) >>> 0) {
       i64toi32_i32$3 = i64toi32_i32$5 >> 31 | 0;
       $128 = i64toi32_i32$5 >> i64toi32_i32$6 | 0;
      } else {
       i64toi32_i32$3 = i64toi32_i32$5 >> i64toi32_i32$6 | 0;
       $128 = (((1 << i64toi32_i32$6 | 0) - 1 | 0) & i64toi32_i32$5 | 0) << (32 - i64toi32_i32$6 | 0) | 0 | (i64toi32_i32$1 >>> i64toi32_i32$6 | 0) | 0;
      }
      $1187$hi = i64toi32_i32$3;
      i64toi32_i32$6 = $15_1;
      i64toi32_i32$3 = $1183$hi;
      i64toi32_i32$1 = $1187$hi;
      i64toi32_i32$4 = i64toi32_i32$6 ? $1183 : $128;
      i64toi32_i32$5 = i64toi32_i32$6 ? i64toi32_i32$3 : i64toi32_i32$1;
      $1189 = i64toi32_i32$4;
      i64toi32_i32$4 = $1179;
      HEAP32[(i64toi32_i32$4 + 144 | 0) >> 2] = $1189;
      HEAP32[(i64toi32_i32$4 + 148 | 0) >> 2] = i64toi32_i32$5;
      i64toi32_i32$6 = $3_1;
      i64toi32_i32$5 = HEAP32[($3_1 + 152 | 0) >> 2] | 0;
      i64toi32_i32$4 = HEAP32[($3_1 + 156 | 0) >> 2] | 0;
      $23_1 = i64toi32_i32$5;
      $23$hi = i64toi32_i32$4;
      block23 : {
       $5_1 = (HEAPU8[($3_1 + 228 | 0) >> 0] | 0) + ((($6_1 ^ -1 | 0) >> 31 | 0) - $11_1 | 0) | 0;
       if (($5_1 | 0) > (0 | 0)) {
        i64toi32_i32$6 = $3_1;
        i64toi32_i32$4 = HEAP32[($3_1 + 160 | 0) >> 2] | 0;
        i64toi32_i32$5 = HEAP32[($3_1 + 164 | 0) >> 2] | 0;
        $1203$hi = i64toi32_i32$5;
        i64toi32_i32$5 = 0;
        $25_1 = $5_1;
        $25$hi = i64toi32_i32$5;
        i64toi32_i32$5 = $1203$hi;
        i64toi32_i32$6 = i64toi32_i32$4;
        i64toi32_i32$4 = $25$hi;
        i64toi32_i32$3 = $5_1;
        i64toi32_i32$1 = $5_1 & 31 | 0;
        if (32 >>> 0 <= ($5_1 & 63 | 0) >>> 0) {
         i64toi32_i32$4 = i64toi32_i32$6 << i64toi32_i32$1 | 0;
         $129 = 0;
        } else {
         i64toi32_i32$4 = ((1 << i64toi32_i32$1 | 0) - 1 | 0) & (i64toi32_i32$6 >>> (32 - i64toi32_i32$1 | 0) | 0) | 0 | (i64toi32_i32$5 << i64toi32_i32$1 | 0) | 0;
         $129 = i64toi32_i32$6 << i64toi32_i32$1 | 0;
        }
        $24_1 = $129;
        $24$hi = i64toi32_i32$4;
        i64toi32_i32$4 = $23$hi;
        i64toi32_i32$4 = $25$hi;
        i64toi32_i32$4 = $23$hi;
        i64toi32_i32$5 = $23_1;
        i64toi32_i32$6 = $25$hi;
        i64toi32_i32$3 = $25_1;
        i64toi32_i32$1 = i64toi32_i32$3 & 31 | 0;
        if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
         i64toi32_i32$6 = i64toi32_i32$5 << i64toi32_i32$1 | 0;
         $130 = 0;
        } else {
         i64toi32_i32$6 = ((1 << i64toi32_i32$1 | 0) - 1 | 0) & (i64toi32_i32$5 >>> (32 - i64toi32_i32$1 | 0) | 0) | 0 | (i64toi32_i32$4 << i64toi32_i32$1 | 0) | 0;
         $130 = i64toi32_i32$5 << i64toi32_i32$1 | 0;
        }
        $1211 = $130;
        $1211$hi = i64toi32_i32$6;
        break block23;
       }
       i64toi32_i32$4 = $3_1;
       i64toi32_i32$6 = HEAP32[($3_1 + 160 | 0) >> 2] | 0;
       i64toi32_i32$5 = HEAP32[($3_1 + 164 | 0) >> 2] | 0;
       $1213$hi = i64toi32_i32$5;
       i64toi32_i32$5 = 0;
       $25_1 = 0 - $5_1 | 0;
       $25$hi = i64toi32_i32$5;
       i64toi32_i32$5 = $1213$hi;
       i64toi32_i32$4 = i64toi32_i32$6;
       i64toi32_i32$6 = $25$hi;
       i64toi32_i32$3 = $25_1;
       i64toi32_i32$1 = i64toi32_i32$3 & 31 | 0;
       if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
        i64toi32_i32$6 = i64toi32_i32$5 >> 31 | 0;
        $131 = i64toi32_i32$5 >> i64toi32_i32$1 | 0;
       } else {
        i64toi32_i32$6 = i64toi32_i32$5 >> i64toi32_i32$1 | 0;
        $131 = (((1 << i64toi32_i32$1 | 0) - 1 | 0) & i64toi32_i32$5 | 0) << (32 - i64toi32_i32$1 | 0) | 0 | (i64toi32_i32$4 >>> i64toi32_i32$1 | 0) | 0;
       }
       $24_1 = $131;
       $24$hi = i64toi32_i32$6;
       i64toi32_i32$6 = $23$hi;
       i64toi32_i32$6 = $25$hi;
       i64toi32_i32$6 = $23$hi;
       i64toi32_i32$5 = $23_1;
       i64toi32_i32$4 = $25$hi;
       i64toi32_i32$3 = $25_1;
       i64toi32_i32$1 = i64toi32_i32$3 & 31 | 0;
       if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
        i64toi32_i32$4 = i64toi32_i32$6 >> 31 | 0;
        $132 = i64toi32_i32$6 >> i64toi32_i32$1 | 0;
       } else {
        i64toi32_i32$4 = i64toi32_i32$6 >> i64toi32_i32$1 | 0;
        $132 = (((1 << i64toi32_i32$1 | 0) - 1 | 0) & i64toi32_i32$6 | 0) << (32 - i64toi32_i32$1 | 0) | 0 | (i64toi32_i32$5 >>> i64toi32_i32$1 | 0) | 0;
       }
       $1211 = $132;
       $1211$hi = i64toi32_i32$4;
      }
      i64toi32_i32$4 = $1211$hi;
      $23_1 = $1211;
      $23$hi = i64toi32_i32$4;
      i64toi32_i32$4 = $24$hi;
      i64toi32_i32$5 = $3_1;
      HEAP32[($3_1 + 160 | 0) >> 2] = $24_1;
      HEAP32[($3_1 + 164 | 0) >> 2] = i64toi32_i32$4;
      i64toi32_i32$4 = $23$hi;
      i64toi32_i32$5 = $3_1;
      HEAP32[($3_1 + 152 | 0) >> 2] = $23_1;
      HEAP32[($3_1 + 156 | 0) >> 2] = i64toi32_i32$4;
      $6_1 = 1024;
      HEAP32[($3_1 + 12 | 0) >> 2] = 1024;
     }
     $5_1 = $6_1 >> 1 | 0;
     $12_1 = ($5_1 | 0) > ($12_1 | 0) ? $12_1 : $5_1;
     $5_1 = $12_1 << 3 | 0;
     if ($5_1) {
      $42($18_1 | 0, $5_1 | 0)
     }
     $15_1 = $12_1 << 1 | 0;
     $8_1 = ($6_1 << 2 | 0) + 73728 | 0;
     $6_1 = ((0 - $6_1 | 0) << 2 | 0) + 77824 | 0;
     block24 : {
      if ($7_1 & 1 | 0) {
       $9_1 = (HEAP32[($3_1 + 168 | 0) >> 2] | 0) - 36 | 0;
       if ((HEAPU8[($3_1 + 228 | 0) >> 0] | 0 | 0) == (1 | 0)) {
        if (($15_1 | 0) <= (0 | 0)) {
         $7_1 = 0;
         break block24;
        }
        $11_1 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
        $17_1 = HEAP32[($3_1 + 172 | 0) >> 2] | 0;
        $7_1 = 0;
        $5_1 = $18_1;
        label7 : while (1) {
         block26 : {
          block25 : {
           if (($11_1 | 0) < ($17_1 | 0)) {
            HEAPF32[$5_1 >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[$8_1 >> 2]) * Math_fround($13($9_1 + ($11_1 << 2 | 0) | 0 | 0, HEAP32[($3_1 + 144 | 0) >> 2] | 0 | 0))) + Math_fround(HEAPF32[$5_1 >> 2]));
            $1282 = $3_1;
            i64toi32_i32$6 = $3_1;
            i64toi32_i32$4 = HEAP32[($3_1 + 144 | 0) >> 2] | 0;
            i64toi32_i32$5 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
            $25_1 = i64toi32_i32$4;
            $25$hi = i64toi32_i32$5;
            i64toi32_i32$6 = $3_1;
            i64toi32_i32$5 = HEAP32[($3_1 + 152 | 0) >> 2] | 0;
            i64toi32_i32$4 = HEAP32[($3_1 + 156 | 0) >> 2] | 0;
            $24_1 = i64toi32_i32$5;
            $24$hi = i64toi32_i32$4;
            i64toi32_i32$4 = $25$hi;
            i64toi32_i32$6 = $25_1;
            i64toi32_i32$5 = $24$hi;
            i64toi32_i32$3 = $24_1;
            i64toi32_i32$1 = i64toi32_i32$6 + i64toi32_i32$3 | 0;
            i64toi32_i32$0 = i64toi32_i32$4 + i64toi32_i32$5 | 0;
            if (i64toi32_i32$1 >>> 0 < i64toi32_i32$3 >>> 0) {
             i64toi32_i32$0 = i64toi32_i32$0 + 1 | 0
            }
            $23_1 = i64toi32_i32$1;
            $23$hi = i64toi32_i32$0;
            i64toi32_i32$6 = $1282;
            HEAP32[(i64toi32_i32$6 + 144 | 0) >> 2] = i64toi32_i32$1;
            HEAP32[(i64toi32_i32$6 + 148 | 0) >> 2] = i64toi32_i32$0;
            $1291 = $17_1;
            i64toi32_i32$4 = i64toi32_i32$1;
            i64toi32_i32$6 = 0;
            i64toi32_i32$3 = 32;
            i64toi32_i32$5 = i64toi32_i32$3 & 31 | 0;
            if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
             i64toi32_i32$6 = 0;
             $133 = i64toi32_i32$0 >>> i64toi32_i32$5 | 0;
            } else {
             i64toi32_i32$6 = i64toi32_i32$0 >>> i64toi32_i32$5 | 0;
             $133 = (((1 << i64toi32_i32$5 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$5 | 0) | 0 | (i64toi32_i32$4 >>> i64toi32_i32$5 | 0) | 0;
            }
            $11_1 = $133;
            if (($1291 | 0) > ($11_1 | 0)) {
             break block25
            }
            i64toi32_i32$6 = $25$hi;
            i64toi32_i32$4 = $16_1;
            HEAP32[i64toi32_i32$4 >> 2] = $25_1;
            HEAP32[(i64toi32_i32$4 + 4 | 0) >> 2] = i64toi32_i32$6;
           }
           if ($7_1) {
            break block26
           }
           $7_1 = 0;
           break block24;
          }
          $26_1 = Math_fround(HEAPF32[($8_1 - 4 | 0) >> 2]);
          i64toi32_i32$6 = $23$hi;
          $27_1 = Math_fround($13($9_1 + ($11_1 << 2 | 0) | 0 | 0, $23_1 | 0));
          $1310 = $3_1;
          i64toi32_i32$6 = $24$hi;
          i64toi32_i32$6 = $23$hi;
          i64toi32_i32$0 = $23_1;
          i64toi32_i32$4 = $24$hi;
          i64toi32_i32$3 = $24_1;
          i64toi32_i32$5 = i64toi32_i32$0 + i64toi32_i32$3 | 0;
          i64toi32_i32$1 = i64toi32_i32$6 + i64toi32_i32$4 | 0;
          if (i64toi32_i32$5 >>> 0 < i64toi32_i32$3 >>> 0) {
           i64toi32_i32$1 = i64toi32_i32$1 + 1 | 0
          }
          $23_1 = i64toi32_i32$5;
          $23$hi = i64toi32_i32$1;
          i64toi32_i32$0 = $1310;
          HEAP32[(i64toi32_i32$0 + 144 | 0) >> 2] = i64toi32_i32$5;
          HEAP32[(i64toi32_i32$0 + 148 | 0) >> 2] = i64toi32_i32$1;
          $11_1 = $5_1 + 4 | 0;
          HEAPF32[$11_1 >> 2] = Math_fround(Math_fround($26_1 * $27_1) + Math_fround(HEAPF32[$11_1 >> 2]));
          $1324 = $3_1;
          i64toi32_i32$6 = $3_1;
          i64toi32_i32$1 = HEAP32[($3_1 + 160 | 0) >> 2] | 0;
          i64toi32_i32$0 = HEAP32[($3_1 + 164 | 0) >> 2] | 0;
          $1326$hi = i64toi32_i32$0;
          i64toi32_i32$0 = $24$hi;
          i64toi32_i32$0 = $1326$hi;
          i64toi32_i32$6 = i64toi32_i32$1;
          i64toi32_i32$1 = $24$hi;
          i64toi32_i32$3 = $24_1;
          i64toi32_i32$4 = i64toi32_i32$6 + i64toi32_i32$3 | 0;
          i64toi32_i32$5 = i64toi32_i32$0 + i64toi32_i32$1 | 0;
          if (i64toi32_i32$4 >>> 0 < i64toi32_i32$3 >>> 0) {
           i64toi32_i32$5 = i64toi32_i32$5 + 1 | 0
          }
          i64toi32_i32$6 = $1324;
          HEAP32[(i64toi32_i32$6 + 152 | 0) >> 2] = i64toi32_i32$4;
          HEAP32[(i64toi32_i32$6 + 156 | 0) >> 2] = i64toi32_i32$5;
          $8_1 = $8_1 - 8 | 0;
          $5_1 = $5_1 + 8 | 0;
          i64toi32_i32$5 = $23$hi;
          i64toi32_i32$0 = $23_1;
          i64toi32_i32$6 = 0;
          i64toi32_i32$3 = 32;
          i64toi32_i32$1 = i64toi32_i32$3 & 31 | 0;
          if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
           i64toi32_i32$6 = 0;
           $134 = i64toi32_i32$5 >>> i64toi32_i32$1 | 0;
          } else {
           i64toi32_i32$6 = i64toi32_i32$5 >>> i64toi32_i32$1 | 0;
           $134 = (((1 << i64toi32_i32$1 | 0) - 1 | 0) & i64toi32_i32$5 | 0) << (32 - i64toi32_i32$1 | 0) | 0 | (i64toi32_i32$0 >>> i64toi32_i32$1 | 0) | 0;
          }
          $11_1 = $134;
          $7_1 = $7_1 + 2 | 0;
          if (($7_1 | 0) < ($15_1 | 0)) {
           continue label7
          }
         }
         break label7;
        };
        $9_1 = (HEAP32[($3_1 + 216 | 0) >> 2] | 0) - 36 | 0;
        $8_1 = HEAP32[($3_1 + 196 | 0) >> 2] | 0;
        $15_1 = HEAP32[($3_1 + 220 | 0) >> 2] | 0;
        $11_1 = 0;
        $5_1 = $18_1;
        label8 : while (1) {
         if (($8_1 | 0) >= ($15_1 | 0)) {
          break block24
         }
         HEAPF32[$5_1 >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[$6_1 >> 2]) * Math_fround($13($9_1 + ($8_1 << 2 | 0) | 0 | 0, HEAP32[($3_1 + 192 | 0) >> 2] | 0 | 0))) + Math_fround(HEAPF32[$5_1 >> 2]));
         $1366 = $3_1;
         i64toi32_i32$5 = $3_1;
         i64toi32_i32$6 = HEAP32[($3_1 + 192 | 0) >> 2] | 0;
         i64toi32_i32$0 = HEAP32[($3_1 + 196 | 0) >> 2] | 0;
         $25_1 = i64toi32_i32$6;
         $25$hi = i64toi32_i32$0;
         i64toi32_i32$5 = $3_1;
         i64toi32_i32$0 = HEAP32[($3_1 + 200 | 0) >> 2] | 0;
         i64toi32_i32$6 = HEAP32[($3_1 + 204 | 0) >> 2] | 0;
         $24_1 = i64toi32_i32$0;
         $24$hi = i64toi32_i32$6;
         i64toi32_i32$6 = $25$hi;
         i64toi32_i32$5 = $25_1;
         i64toi32_i32$0 = $24$hi;
         i64toi32_i32$3 = $24_1;
         i64toi32_i32$1 = i64toi32_i32$5 + i64toi32_i32$3 | 0;
         i64toi32_i32$4 = i64toi32_i32$6 + i64toi32_i32$0 | 0;
         if (i64toi32_i32$1 >>> 0 < i64toi32_i32$3 >>> 0) {
          i64toi32_i32$4 = i64toi32_i32$4 + 1 | 0
         }
         $23_1 = i64toi32_i32$1;
         $23$hi = i64toi32_i32$4;
         i64toi32_i32$5 = $1366;
         HEAP32[(i64toi32_i32$5 + 192 | 0) >> 2] = i64toi32_i32$1;
         HEAP32[(i64toi32_i32$5 + 196 | 0) >> 2] = i64toi32_i32$4;
         i64toi32_i32$6 = i64toi32_i32$1;
         i64toi32_i32$5 = 0;
         i64toi32_i32$3 = 32;
         i64toi32_i32$0 = i64toi32_i32$3 & 31 | 0;
         if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
          i64toi32_i32$5 = 0;
          $135 = i64toi32_i32$4 >>> i64toi32_i32$0 | 0;
         } else {
          i64toi32_i32$5 = i64toi32_i32$4 >>> i64toi32_i32$0 | 0;
          $135 = (((1 << i64toi32_i32$0 | 0) - 1 | 0) & i64toi32_i32$4 | 0) << (32 - i64toi32_i32$0 | 0) | 0 | (i64toi32_i32$6 >>> i64toi32_i32$0 | 0) | 0;
         }
         $8_1 = $135;
         if (($8_1 | 0) >= ($15_1 | 0)) {
          i64toi32_i32$5 = $25$hi;
          i64toi32_i32$6 = $14_1;
          HEAP32[i64toi32_i32$6 >> 2] = $25_1;
          HEAP32[(i64toi32_i32$6 + 4 | 0) >> 2] = i64toi32_i32$5;
          break block24;
         }
         $26_1 = Math_fround(HEAPF32[($6_1 + 4 | 0) >> 2]);
         i64toi32_i32$5 = $23$hi;
         $27_1 = Math_fround($13($9_1 + ($8_1 << 2 | 0) | 0 | 0, $23_1 | 0));
         $1393 = $3_1;
         i64toi32_i32$5 = $24$hi;
         i64toi32_i32$5 = $23$hi;
         i64toi32_i32$4 = $23_1;
         i64toi32_i32$6 = $24$hi;
         i64toi32_i32$3 = $24_1;
         i64toi32_i32$0 = i64toi32_i32$4 + i64toi32_i32$3 | 0;
         i64toi32_i32$1 = i64toi32_i32$5 + i64toi32_i32$6 | 0;
         if (i64toi32_i32$0 >>> 0 < i64toi32_i32$3 >>> 0) {
          i64toi32_i32$1 = i64toi32_i32$1 + 1 | 0
         }
         $23_1 = i64toi32_i32$0;
         $23$hi = i64toi32_i32$1;
         i64toi32_i32$4 = $1393;
         HEAP32[(i64toi32_i32$4 + 192 | 0) >> 2] = i64toi32_i32$0;
         HEAP32[(i64toi32_i32$4 + 196 | 0) >> 2] = i64toi32_i32$1;
         $8_1 = $5_1 + 4 | 0;
         HEAPF32[$8_1 >> 2] = Math_fround(Math_fround($26_1 * $27_1) + Math_fround(HEAPF32[$8_1 >> 2]));
         $1407 = $3_1;
         i64toi32_i32$5 = $3_1;
         i64toi32_i32$1 = HEAP32[($3_1 + 208 | 0) >> 2] | 0;
         i64toi32_i32$4 = HEAP32[($3_1 + 212 | 0) >> 2] | 0;
         $1409$hi = i64toi32_i32$4;
         i64toi32_i32$4 = $24$hi;
         i64toi32_i32$4 = $1409$hi;
         i64toi32_i32$5 = i64toi32_i32$1;
         i64toi32_i32$1 = $24$hi;
         i64toi32_i32$3 = $24_1;
         i64toi32_i32$6 = i64toi32_i32$5 + i64toi32_i32$3 | 0;
         i64toi32_i32$0 = i64toi32_i32$4 + i64toi32_i32$1 | 0;
         if (i64toi32_i32$6 >>> 0 < i64toi32_i32$3 >>> 0) {
          i64toi32_i32$0 = i64toi32_i32$0 + 1 | 0
         }
         i64toi32_i32$5 = $1407;
         HEAP32[(i64toi32_i32$5 + 200 | 0) >> 2] = i64toi32_i32$6;
         HEAP32[(i64toi32_i32$5 + 204 | 0) >> 2] = i64toi32_i32$0;
         $5_1 = $5_1 + 8 | 0;
         $6_1 = $6_1 + 8 | 0;
         i64toi32_i32$0 = $23$hi;
         i64toi32_i32$4 = $23_1;
         i64toi32_i32$5 = 0;
         i64toi32_i32$3 = 32;
         i64toi32_i32$1 = i64toi32_i32$3 & 31 | 0;
         if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
          i64toi32_i32$5 = 0;
          $136 = i64toi32_i32$0 >>> i64toi32_i32$1 | 0;
         } else {
          i64toi32_i32$5 = i64toi32_i32$0 >>> i64toi32_i32$1 | 0;
          $136 = (((1 << i64toi32_i32$1 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$1 | 0) | 0 | (i64toi32_i32$4 >>> i64toi32_i32$1 | 0) | 0;
         }
         $8_1 = $136;
         $11_1 = $11_1 + 2 | 0;
         if (($11_1 | 0) < ($7_1 | 0)) {
          continue label8
         }
         break label8;
        };
        break block24;
       }
       if (($15_1 | 0) <= (0 | 0)) {
        $7_1 = 0;
        $15($14_1 | 0, $6_1 | 0, 2 | 0, $18_1 | 0, 0 | 0);
        break block24;
       }
       $11_1 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
       $17_1 = HEAP32[($3_1 + 172 | 0) >> 2] | 0;
       $7_1 = 0;
       $5_1 = $18_1;
       label9 : while (1) {
        if (($11_1 | 0) < ($17_1 | 0)) {
         HEAPF32[$5_1 >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[$8_1 >> 2]) * Math_fround($13($9_1 + ($11_1 << 2 | 0) | 0 | 0, HEAP32[($3_1 + 144 | 0) >> 2] | 0 | 0))) + Math_fround(HEAPF32[$5_1 >> 2]));
         $1451 = $3_1;
         i64toi32_i32$0 = $3_1;
         i64toi32_i32$5 = HEAP32[($3_1 + 144 | 0) >> 2] | 0;
         i64toi32_i32$4 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
         $25_1 = i64toi32_i32$5;
         $25$hi = i64toi32_i32$4;
         i64toi32_i32$0 = $3_1;
         i64toi32_i32$4 = HEAP32[($3_1 + 152 | 0) >> 2] | 0;
         i64toi32_i32$5 = HEAP32[($3_1 + 156 | 0) >> 2] | 0;
         $24_1 = i64toi32_i32$4;
         $24$hi = i64toi32_i32$5;
         i64toi32_i32$5 = $25$hi;
         i64toi32_i32$0 = $25_1;
         i64toi32_i32$4 = $24$hi;
         i64toi32_i32$3 = $24_1;
         i64toi32_i32$1 = i64toi32_i32$0 + i64toi32_i32$3 | 0;
         i64toi32_i32$6 = i64toi32_i32$5 + i64toi32_i32$4 | 0;
         if (i64toi32_i32$1 >>> 0 < i64toi32_i32$3 >>> 0) {
          i64toi32_i32$6 = i64toi32_i32$6 + 1 | 0
         }
         $23_1 = i64toi32_i32$1;
         $23$hi = i64toi32_i32$6;
         i64toi32_i32$0 = $1451;
         HEAP32[(i64toi32_i32$0 + 144 | 0) >> 2] = i64toi32_i32$1;
         HEAP32[(i64toi32_i32$0 + 148 | 0) >> 2] = i64toi32_i32$6;
         i64toi32_i32$5 = i64toi32_i32$1;
         i64toi32_i32$0 = 0;
         i64toi32_i32$3 = 32;
         i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
         if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
          i64toi32_i32$0 = 0;
          $137 = i64toi32_i32$6 >>> i64toi32_i32$4 | 0;
         } else {
          i64toi32_i32$0 = i64toi32_i32$6 >>> i64toi32_i32$4 | 0;
          $137 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$6 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$5 >>> i64toi32_i32$4 | 0) | 0;
         }
         $11_1 = $137;
         if (($11_1 | 0) >= ($17_1 | 0)) {
          i64toi32_i32$0 = $25$hi;
          i64toi32_i32$5 = $16_1;
          HEAP32[i64toi32_i32$5 >> 2] = $25_1;
          HEAP32[(i64toi32_i32$5 + 4 | 0) >> 2] = i64toi32_i32$0;
          $15($14_1 | 0, $6_1 | 0, 2 | 0, $18_1 | 0, $7_1 | 0);
          break block24;
         }
         $26_1 = Math_fround(HEAPF32[($8_1 - 4 | 0) >> 2]);
         i64toi32_i32$0 = $23$hi;
         $27_1 = Math_fround($13($9_1 + ($11_1 << 2 | 0) | 0 | 0, $23_1 | 0));
         $1482 = $3_1;
         i64toi32_i32$0 = $24$hi;
         i64toi32_i32$0 = $23$hi;
         i64toi32_i32$6 = $23_1;
         i64toi32_i32$5 = $24$hi;
         i64toi32_i32$3 = $24_1;
         i64toi32_i32$4 = i64toi32_i32$6 + i64toi32_i32$3 | 0;
         i64toi32_i32$1 = i64toi32_i32$0 + i64toi32_i32$5 | 0;
         if (i64toi32_i32$4 >>> 0 < i64toi32_i32$3 >>> 0) {
          i64toi32_i32$1 = i64toi32_i32$1 + 1 | 0
         }
         $23_1 = i64toi32_i32$4;
         $23$hi = i64toi32_i32$1;
         i64toi32_i32$6 = $1482;
         HEAP32[(i64toi32_i32$6 + 144 | 0) >> 2] = i64toi32_i32$4;
         HEAP32[(i64toi32_i32$6 + 148 | 0) >> 2] = i64toi32_i32$1;
         $11_1 = $5_1 + 4 | 0;
         HEAPF32[$11_1 >> 2] = Math_fround(Math_fround($26_1 * $27_1) + Math_fround(HEAPF32[$11_1 >> 2]));
         $1496 = $3_1;
         i64toi32_i32$0 = $3_1;
         i64toi32_i32$1 = HEAP32[($3_1 + 160 | 0) >> 2] | 0;
         i64toi32_i32$6 = HEAP32[($3_1 + 164 | 0) >> 2] | 0;
         $1498$hi = i64toi32_i32$6;
         i64toi32_i32$6 = $24$hi;
         i64toi32_i32$6 = $1498$hi;
         i64toi32_i32$0 = i64toi32_i32$1;
         i64toi32_i32$1 = $24$hi;
         i64toi32_i32$3 = $24_1;
         i64toi32_i32$5 = i64toi32_i32$0 + i64toi32_i32$3 | 0;
         i64toi32_i32$4 = i64toi32_i32$6 + i64toi32_i32$1 | 0;
         if (i64toi32_i32$5 >>> 0 < i64toi32_i32$3 >>> 0) {
          i64toi32_i32$4 = i64toi32_i32$4 + 1 | 0
         }
         i64toi32_i32$0 = $1496;
         HEAP32[(i64toi32_i32$0 + 152 | 0) >> 2] = i64toi32_i32$5;
         HEAP32[(i64toi32_i32$0 + 156 | 0) >> 2] = i64toi32_i32$4;
         $8_1 = $8_1 - 8 | 0;
         $5_1 = $5_1 + 8 | 0;
         i64toi32_i32$4 = $23$hi;
         i64toi32_i32$6 = $23_1;
         i64toi32_i32$0 = 0;
         i64toi32_i32$3 = 32;
         i64toi32_i32$1 = i64toi32_i32$3 & 31 | 0;
         if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
          i64toi32_i32$0 = 0;
          $138 = i64toi32_i32$4 >>> i64toi32_i32$1 | 0;
         } else {
          i64toi32_i32$0 = i64toi32_i32$4 >>> i64toi32_i32$1 | 0;
          $138 = (((1 << i64toi32_i32$1 | 0) - 1 | 0) & i64toi32_i32$4 | 0) << (32 - i64toi32_i32$1 | 0) | 0 | (i64toi32_i32$6 >>> i64toi32_i32$1 | 0) | 0;
         }
         $11_1 = $138;
         $7_1 = $7_1 + 2 | 0;
         if (($7_1 | 0) < ($15_1 | 0)) {
          continue label9
         }
        }
        break label9;
       };
       $15($14_1 | 0, $6_1 | 0, 2 | 0, $18_1 | 0, $7_1 | 0);
       break block24;
      }
      block27 : {
       if (($15_1 | 0) <= (0 | 0)) {
        $7_1 = 0;
        break block27;
       }
       $11_1 = (HEAP32[($3_1 + 216 | 0) >> 2] | 0) - 36 | 0;
       $9_1 = HEAP32[($3_1 + 196 | 0) >> 2] | 0;
       $17_1 = HEAP32[($3_1 + 220 | 0) >> 2] | 0;
       $7_1 = 0;
       $5_1 = $18_1;
       label10 : while (1) {
        if (($9_1 | 0) >= ($17_1 | 0)) {
         break block27
        }
        HEAPF32[$5_1 >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[$6_1 >> 2]) * Math_fround($13($11_1 + ($9_1 << 2 | 0) | 0 | 0, HEAP32[($3_1 + 192 | 0) >> 2] | 0 | 0))) + Math_fround(HEAPF32[$5_1 >> 2]));
        $1544 = $3_1;
        i64toi32_i32$4 = $3_1;
        i64toi32_i32$0 = HEAP32[($3_1 + 192 | 0) >> 2] | 0;
        i64toi32_i32$6 = HEAP32[($3_1 + 196 | 0) >> 2] | 0;
        $25_1 = i64toi32_i32$0;
        $25$hi = i64toi32_i32$6;
        i64toi32_i32$4 = $3_1;
        i64toi32_i32$6 = HEAP32[($3_1 + 200 | 0) >> 2] | 0;
        i64toi32_i32$0 = HEAP32[($3_1 + 204 | 0) >> 2] | 0;
        $24_1 = i64toi32_i32$6;
        $24$hi = i64toi32_i32$0;
        i64toi32_i32$0 = $25$hi;
        i64toi32_i32$4 = $25_1;
        i64toi32_i32$6 = $24$hi;
        i64toi32_i32$3 = $24_1;
        i64toi32_i32$1 = i64toi32_i32$4 + i64toi32_i32$3 | 0;
        i64toi32_i32$5 = i64toi32_i32$0 + i64toi32_i32$6 | 0;
        if (i64toi32_i32$1 >>> 0 < i64toi32_i32$3 >>> 0) {
         i64toi32_i32$5 = i64toi32_i32$5 + 1 | 0
        }
        $23_1 = i64toi32_i32$1;
        $23$hi = i64toi32_i32$5;
        i64toi32_i32$4 = $1544;
        HEAP32[(i64toi32_i32$4 + 192 | 0) >> 2] = i64toi32_i32$1;
        HEAP32[(i64toi32_i32$4 + 196 | 0) >> 2] = i64toi32_i32$5;
        i64toi32_i32$0 = i64toi32_i32$1;
        i64toi32_i32$4 = 0;
        i64toi32_i32$3 = 32;
        i64toi32_i32$6 = i64toi32_i32$3 & 31 | 0;
        if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
         i64toi32_i32$4 = 0;
         $139 = i64toi32_i32$5 >>> i64toi32_i32$6 | 0;
        } else {
         i64toi32_i32$4 = i64toi32_i32$5 >>> i64toi32_i32$6 | 0;
         $139 = (((1 << i64toi32_i32$6 | 0) - 1 | 0) & i64toi32_i32$5 | 0) << (32 - i64toi32_i32$6 | 0) | 0 | (i64toi32_i32$0 >>> i64toi32_i32$6 | 0) | 0;
        }
        $9_1 = $139;
        if (($9_1 | 0) >= ($17_1 | 0)) {
         i64toi32_i32$4 = $25$hi;
         i64toi32_i32$0 = $14_1;
         HEAP32[i64toi32_i32$0 >> 2] = $25_1;
         HEAP32[(i64toi32_i32$0 + 4 | 0) >> 2] = i64toi32_i32$4;
         break block27;
        }
        $26_1 = Math_fround(HEAPF32[($6_1 + 4 | 0) >> 2]);
        i64toi32_i32$4 = $23$hi;
        $27_1 = Math_fround($13($11_1 + ($9_1 << 2 | 0) | 0 | 0, $23_1 | 0));
        $1571 = $3_1;
        i64toi32_i32$4 = $24$hi;
        i64toi32_i32$4 = $23$hi;
        i64toi32_i32$5 = $23_1;
        i64toi32_i32$0 = $24$hi;
        i64toi32_i32$3 = $24_1;
        i64toi32_i32$6 = i64toi32_i32$5 + i64toi32_i32$3 | 0;
        i64toi32_i32$1 = i64toi32_i32$4 + i64toi32_i32$0 | 0;
        if (i64toi32_i32$6 >>> 0 < i64toi32_i32$3 >>> 0) {
         i64toi32_i32$1 = i64toi32_i32$1 + 1 | 0
        }
        $23_1 = i64toi32_i32$6;
        $23$hi = i64toi32_i32$1;
        i64toi32_i32$5 = $1571;
        HEAP32[(i64toi32_i32$5 + 192 | 0) >> 2] = i64toi32_i32$6;
        HEAP32[(i64toi32_i32$5 + 196 | 0) >> 2] = i64toi32_i32$1;
        $9_1 = $5_1 + 4 | 0;
        HEAPF32[$9_1 >> 2] = Math_fround(Math_fround($26_1 * $27_1) + Math_fround(HEAPF32[$9_1 >> 2]));
        $1585 = $3_1;
        i64toi32_i32$4 = $3_1;
        i64toi32_i32$1 = HEAP32[($3_1 + 208 | 0) >> 2] | 0;
        i64toi32_i32$5 = HEAP32[($3_1 + 212 | 0) >> 2] | 0;
        $1587$hi = i64toi32_i32$5;
        i64toi32_i32$5 = $24$hi;
        i64toi32_i32$5 = $1587$hi;
        i64toi32_i32$4 = i64toi32_i32$1;
        i64toi32_i32$1 = $24$hi;
        i64toi32_i32$3 = $24_1;
        i64toi32_i32$0 = i64toi32_i32$4 + i64toi32_i32$3 | 0;
        i64toi32_i32$6 = i64toi32_i32$5 + i64toi32_i32$1 | 0;
        if (i64toi32_i32$0 >>> 0 < i64toi32_i32$3 >>> 0) {
         i64toi32_i32$6 = i64toi32_i32$6 + 1 | 0
        }
        i64toi32_i32$4 = $1585;
        HEAP32[(i64toi32_i32$4 + 200 | 0) >> 2] = i64toi32_i32$0;
        HEAP32[(i64toi32_i32$4 + 204 | 0) >> 2] = i64toi32_i32$6;
        $5_1 = $5_1 + 8 | 0;
        $6_1 = $6_1 + 8 | 0;
        i64toi32_i32$6 = $23$hi;
        i64toi32_i32$5 = $23_1;
        i64toi32_i32$4 = 0;
        i64toi32_i32$3 = 32;
        i64toi32_i32$1 = i64toi32_i32$3 & 31 | 0;
        if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
         i64toi32_i32$4 = 0;
         $140 = i64toi32_i32$6 >>> i64toi32_i32$1 | 0;
        } else {
         i64toi32_i32$4 = i64toi32_i32$6 >>> i64toi32_i32$1 | 0;
         $140 = (((1 << i64toi32_i32$1 | 0) - 1 | 0) & i64toi32_i32$6 | 0) << (32 - i64toi32_i32$1 | 0) | 0 | (i64toi32_i32$5 >>> i64toi32_i32$1 | 0) | 0;
        }
        $9_1 = $140;
        $7_1 = $7_1 + 2 | 0;
        if (($7_1 | 0) < ($15_1 | 0)) {
         continue label10
        }
        break label10;
       };
      }
      $15($16_1 | 0, $8_1 | 0, -2 | 0, $18_1 | 0, $7_1 | 0);
     }
     $5_1 = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
     HEAP32[($3_1 + 12 | 0) >> 2] = $5_1 - $7_1 | 0;
     block28 : {
      if (($5_1 | 0) != ($7_1 | 0)) {
       break block28
      }
      if (HEAP32[($3_1 + 24 | 0) >> 2] | 0) {
       HEAP32[($3_1 + 28 | 0) >> 2] = $13_1;
       $13_1 = $13_1 + 1 | 0;
       break block28;
      }
      $10_1 = $10_1 - 1 | 0;
     }
     $5_1 = $7_1 >> 1 | 0;
     $14($22_1 | 0, $21_1 + ($19_1 << 2 | 0) | 0 | 0, $18_1 | 0, $5_1 | 0);
    }
    $6_1 = HEAP32[($3_1 + 16 | 0) >> 2] | 0;
    if ($6_1) {
     HEAP32[($3_1 + 16 | 0) >> 2] = $6_1 - $5_1 | 0
    }
    $19_1 = $5_1 + $19_1 | 0;
    if (($5_1 | 0) == ($12_1 | 0)) {
     continue label11
    }
   }
   break label11;
  };
  $12_1 = HEAP32[($3_1 + 148 | 0) >> 2] | 0;
  $5_1 = ($10_1 | 0) > (0 | 0) ? $10_1 : 0;
  $6_1 = $5_1 - (HEAP32[($3_1 + 176 | 0) >> 2] | 0) | 0;
  $10_1 = 0 - $6_1 | 0;
  $7_1 = ($6_1 | 0) < (0 | 0) ? $12_1 << $10_1 | 0 : $12_1 >> $6_1 | 0;
  HEAP32[($3_1 + 148 | 0) >> 2] = $12_1 - (($6_1 | 0) > (0 | 0) ? $7_1 << $6_1 | 0 : $7_1 >> $10_1 | 0) | 0;
  if (HEAP32[($3_1 + 12 | 0) >> 2] | 0) {
   $6_1 = $5_1 - (HEAP32[($3_1 + 224 | 0) >> 2] | 0) | 0;
   HEAP32[($3_1 + 196 | 0) >> 2] = (HEAP32[($3_1 + 196 | 0) >> 2] | 0) - (($6_1 | 0) > (0 | 0) ? $7_1 << $6_1 | 0 : $7_1 >> (0 - $6_1 | 0) | 0) | 0;
  }
  $10_1 = HEAP32[($3_1 + 48 | 0) >> 2] | 0;
  $13_1 = $13_1 & ($13_1 >> 31 | 0) | 0;
  if (($13_1 + $5_1 | 0) & 1 | 0) {
   $1735 = $5_1
  } else {
   $6_1 = $10_1 + Math_imul($5_1, 48) | 0;
   $12_1 = Math_imul(HEAP32[($6_1 + 8 | 0) >> 2] | 0, $7_1);
   $8_1 = HEAP32[($6_1 + 12 | 0) >> 2] | 0;
   if ($12_1 >>> 0 <= ((HEAP32[($6_1 + 16 | 0) >> 2] | 0) - $8_1 | 0) >>> 0) {
    HEAP32[($6_1 + 12 | 0) >> 2] = $8_1 + $12_1 | 0
   }
   $7_1 = $7_1 << 1 | 0;
   $1735 = $5_1 - 1 | 0;
  }
  $12_1 = $1735;
  if (($5_1 | 0) != ($13_1 | 0)) {
   $5_1 = $12_1 + 1 | 0;
   $6_1 = (Math_imul($12_1, 48) + $10_1 | 0) + 16 | 0;
   label12 : while (1) {
    $12_1 = Math_imul(HEAP32[($6_1 - 8 | 0) >> 2] | 0, $7_1);
    $10_1 = $6_1 - 4 | 0;
    $8_1 = HEAP32[$10_1 >> 2] | 0;
    if ($12_1 >>> 0 <= ((HEAP32[$6_1 >> 2] | 0) - $8_1 | 0) >>> 0) {
     HEAP32[$10_1 >> 2] = $8_1 + $12_1 | 0
    }
    $12_1 = Math_imul($7_1, HEAP32[($6_1 - 56 | 0) >> 2] | 0) << 1 | 0;
    $10_1 = $6_1 - 52 | 0;
    $8_1 = HEAP32[$10_1 >> 2] | 0;
    if ($12_1 >>> 0 <= ((HEAP32[($6_1 - 48 | 0) >> 2] | 0) - $8_1 | 0) >>> 0) {
     HEAP32[$10_1 >> 2] = $8_1 + $12_1 | 0
    }
    $6_1 = $6_1 - 96 | 0;
    $7_1 = $7_1 << 2 | 0;
    $5_1 = $5_1 - 2 | 0;
    if (($5_1 | 0) > ($13_1 | 0)) {
     continue label12
    }
    break label12;
   };
  }
  HEAP32[($3_1 + 68 | 0) >> 2] = (HEAP32[($3_1 + 68 | 0) >> 2] | 0) + Math_imul(HEAP32[($3_1 + 60 | 0) >> 2] | 0, $19_1 - $4_1 | 0) | 0;
  global$0 = $18_1 + 512 | 0;
 }
 
 function $11($0_1) {
  $0_1 = +$0_1;
  var i64toi32_i32$2 = 0, i64toi32_i32$3 = 0, i64toi32_i32$5 = 0, i64toi32_i32$1 = 0, i64toi32_i32$0 = 0, i64toi32_i32$4 = 0, $1_1 = 0.0, $6_1 = 0, $6$hi = 0, i64toi32_i32$6 = 0, $2_1 = 0.0, $3_1 = 0.0, $8_1 = 0, $4_1 = 0.0, $90 = 0.0, $5_1 = 0.0, $24_1 = 0, $25_1 = 0, $26_1 = 0, $27_1 = 0, $7_1 = 0, $7$hi = 0, $28_1 = 0, $29_1 = 0, $97 = 0, $118 = 0.0, $129 = 0.0, $132 = 0, $132$hi = 0;
  wasm2js_scratch_store_f64(+$0_1);
  i64toi32_i32$0 = wasm2js_scratch_load_i32(1 | 0) | 0;
  $6_1 = wasm2js_scratch_load_i32(0 | 0) | 0;
  $6$hi = i64toi32_i32$0;
  i64toi32_i32$2 = $6_1;
  i64toi32_i32$1 = 1072562176;
  i64toi32_i32$3 = 0;
  i64toi32_i32$4 = i64toi32_i32$2 - i64toi32_i32$3 | 0;
  i64toi32_i32$6 = i64toi32_i32$2 >>> 0 < i64toi32_i32$3 >>> 0;
  i64toi32_i32$5 = i64toi32_i32$6 + i64toi32_i32$1 | 0;
  i64toi32_i32$5 = i64toi32_i32$0 - i64toi32_i32$5 | 0;
  i64toi32_i32$0 = i64toi32_i32$4;
  i64toi32_i32$2 = 198911;
  i64toi32_i32$3 = -1;
  if (i64toi32_i32$5 >>> 0 < i64toi32_i32$2 >>> 0 | ((i64toi32_i32$5 | 0) == (i64toi32_i32$2 | 0) & i64toi32_i32$0 >>> 0 <= i64toi32_i32$3 >>> 0 | 0) | 0) {
   $0_1 = $0_1 + -1.0;
   $1_1 = $0_1 * 134217728.0;
   $1_1 = $0_1 + $1_1 - $1_1;
   $4_1 = $1_1 * $1_1 * -.5;
   $5_1 = $0_1 + $4_1;
   $2_1 = $0_1 * $0_1;
   $3_1 = $0_1 * $2_1;
   return +($5_1 + ($3_1 * ($3_1 * ($3_1 * ($3_1 * -.08328363062289341 + ($2_1 * .09181994006195467 + ($0_1 * -.10000486757818193 + .11110712032936046))) + ($2_1 * -.12499997863982555 + ($0_1 * .14285715076560868 + -.16666666669929706))) + ($2_1 * .19999999999320328 + ($0_1 * -.24999999999998432 + .3333333333333352))) + (($0_1 - $1_1) * -.5 * ($0_1 + $1_1) + ($4_1 + ($0_1 - $5_1)))));
  }
  block : {
   i64toi32_i32$0 = $6$hi;
   i64toi32_i32$3 = $6_1;
   i64toi32_i32$5 = 0;
   i64toi32_i32$2 = 48;
   i64toi32_i32$1 = i64toi32_i32$2 & 31 | 0;
   if (32 >>> 0 <= (i64toi32_i32$2 & 63 | 0) >>> 0) {
    i64toi32_i32$5 = 0;
    $24_1 = i64toi32_i32$0 >>> i64toi32_i32$1 | 0;
   } else {
    i64toi32_i32$5 = i64toi32_i32$0 >>> i64toi32_i32$1 | 0;
    $24_1 = (((1 << i64toi32_i32$1 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$1 | 0) | 0 | (i64toi32_i32$3 >>> i64toi32_i32$1 | 0) | 0;
   }
   $8_1 = $24_1;
   if (($8_1 - 32752 | 0) >>> 0 <= -32737 >>> 0) {
    $90 = -Infinity;
    if ($0_1 == 0.0) {
     break block
    }
    i64toi32_i32$5 = $6$hi;
    i64toi32_i32$0 = $6_1;
    i64toi32_i32$3 = 2146435072;
    i64toi32_i32$2 = 0;
    if ((i64toi32_i32$0 | 0) == (i64toi32_i32$2 | 0) & (i64toi32_i32$5 | 0) == (i64toi32_i32$3 | 0) | 0) {
     return +$0_1
    }
    $97 = ($8_1 & 32752 | 0 | 0) != (32752 | 0);
    i64toi32_i32$0 = $6$hi;
    i64toi32_i32$2 = $6_1;
    i64toi32_i32$5 = 0;
    i64toi32_i32$3 = 0;
    if ((i64toi32_i32$0 | 0) > (i64toi32_i32$5 | 0)) {
     $25_1 = 1
    } else {
     if ((i64toi32_i32$0 | 0) >= (i64toi32_i32$5 | 0)) {
      if (i64toi32_i32$2 >>> 0 < i64toi32_i32$3 >>> 0) {
       $26_1 = 0
      } else {
       $26_1 = 1
      }
      $27_1 = $26_1;
     } else {
      $27_1 = 0
     }
     $25_1 = $27_1;
    }
    if (!($97 & $25_1 | 0)) {
     $0_1 = $0_1 - $0_1;
     return +($0_1 / $0_1);
    }
    wasm2js_scratch_store_f64(+($0_1 * 4503599627370496.0));
    i64toi32_i32$2 = wasm2js_scratch_load_i32(1 | 0) | 0;
    i64toi32_i32$3 = wasm2js_scratch_load_i32(0 | 0) | 0;
    i64toi32_i32$0 = 54525952;
    i64toi32_i32$5 = 0;
    i64toi32_i32$1 = i64toi32_i32$3 - i64toi32_i32$5 | 0;
    i64toi32_i32$6 = i64toi32_i32$3 >>> 0 < i64toi32_i32$5 >>> 0;
    i64toi32_i32$4 = i64toi32_i32$6 + i64toi32_i32$0 | 0;
    i64toi32_i32$4 = i64toi32_i32$2 - i64toi32_i32$4 | 0;
    $6_1 = i64toi32_i32$1;
    $6$hi = i64toi32_i32$4;
   }
   i64toi32_i32$4 = $6$hi;
   i64toi32_i32$2 = $6_1;
   i64toi32_i32$3 = 1072037888;
   i64toi32_i32$5 = 0;
   i64toi32_i32$0 = i64toi32_i32$2 - i64toi32_i32$5 | 0;
   i64toi32_i32$6 = i64toi32_i32$2 >>> 0 < i64toi32_i32$5 >>> 0;
   i64toi32_i32$1 = i64toi32_i32$6 + i64toi32_i32$3 | 0;
   i64toi32_i32$1 = i64toi32_i32$4 - i64toi32_i32$1 | 0;
   $7_1 = i64toi32_i32$0;
   $7$hi = i64toi32_i32$1;
   i64toi32_i32$4 = i64toi32_i32$0;
   i64toi32_i32$2 = 0;
   i64toi32_i32$5 = 52;
   i64toi32_i32$3 = i64toi32_i32$5 & 31 | 0;
   if (32 >>> 0 <= (i64toi32_i32$5 & 63 | 0) >>> 0) {
    i64toi32_i32$2 = i64toi32_i32$1 >> 31 | 0;
    $28_1 = i64toi32_i32$1 >> i64toi32_i32$3 | 0;
   } else {
    i64toi32_i32$2 = i64toi32_i32$1 >> i64toi32_i32$3 | 0;
    $28_1 = (((1 << i64toi32_i32$3 | 0) - 1 | 0) & i64toi32_i32$1 | 0) << (32 - i64toi32_i32$3 | 0) | 0 | (i64toi32_i32$4 >>> i64toi32_i32$3 | 0) | 0;
   }
   i64toi32_i32$4 = $28_1;
   i64toi32_i32$1 = 0;
   $2_1 = +(i64toi32_i32$4 >>> 0) + 4294967296.0 * +(i64toi32_i32$2 | 0);
   $118 = $2_1 * .6931471805598903;
   i64toi32_i32$2 = $7$hi;
   i64toi32_i32$1 = $7_1;
   i64toi32_i32$4 = 0;
   i64toi32_i32$5 = 45;
   i64toi32_i32$3 = i64toi32_i32$5 & 31 | 0;
   if (32 >>> 0 <= (i64toi32_i32$5 & 63 | 0) >>> 0) {
    i64toi32_i32$4 = 0;
    $29_1 = i64toi32_i32$2 >>> i64toi32_i32$3 | 0;
   } else {
    i64toi32_i32$4 = i64toi32_i32$2 >>> i64toi32_i32$3 | 0;
    $29_1 = (((1 << i64toi32_i32$3 | 0) - 1 | 0) & i64toi32_i32$2 | 0) << (32 - i64toi32_i32$3 | 0) | 0 | (i64toi32_i32$1 >>> i64toi32_i32$3 | 0) | 0;
   }
   $8_1 = ($29_1 & 127 | 0) << 4 | 0;
   $3_1 = $118 + +HEAPF64[($8_1 + 69608 | 0) >> 3];
   $129 = +HEAPF64[($8_1 + 69600 | 0) >> 3];
   i64toi32_i32$4 = $6$hi;
   i64toi32_i32$4 = $7$hi;
   i64toi32_i32$2 = $7_1;
   i64toi32_i32$1 = -1048576;
   i64toi32_i32$5 = 0;
   i64toi32_i32$1 = i64toi32_i32$4 & i64toi32_i32$1 | 0;
   $132 = i64toi32_i32$2 & i64toi32_i32$5 | 0;
   $132$hi = i64toi32_i32$1;
   i64toi32_i32$1 = $6$hi;
   i64toi32_i32$4 = $6_1;
   i64toi32_i32$2 = $132$hi;
   i64toi32_i32$5 = $132;
   i64toi32_i32$3 = i64toi32_i32$4 - i64toi32_i32$5 | 0;
   i64toi32_i32$6 = i64toi32_i32$4 >>> 0 < i64toi32_i32$5 >>> 0;
   i64toi32_i32$0 = i64toi32_i32$6 + i64toi32_i32$2 | 0;
   i64toi32_i32$0 = i64toi32_i32$1 - i64toi32_i32$0 | 0;
   wasm2js_scratch_store_i32(0 | 0, i64toi32_i32$3 | 0);
   wasm2js_scratch_store_i32(1 | 0, i64toi32_i32$0 | 0);
   $0_1 = $129 * (+wasm2js_scratch_load_f64() - +HEAPF64[($8_1 + 71648 | 0) >> 3] - +HEAPF64[($8_1 + 71656 | 0) >> 3]);
   $4_1 = $3_1 + $0_1;
   $1_1 = $0_1 * $0_1;
   $90 = $4_1 + ($0_1 * $1_1 * ($1_1 * ($0_1 * -.16667054827627667 + .20000304511814496) + ($0_1 * -.2499999999622955 + .33333333331825593)) + ($1_1 * -.5000000000000001 + ($2_1 * 5.497923018708371e-14 + ($0_1 + ($3_1 - $4_1)))));
  }
  return +$90;
 }
 
 function $12($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  var $4_1 = 0, $5_1 = 0, $6_1 = 0, $7_1 = 0, $9_1 = 0, $8_1 = 0, $10_1 = 0, $11_1 = 0, $12_1 = 0, $66 = Math_fround(0), i64toi32_i32$0 = 0, $188 = 0, $1568 = 0, $13_1 = 0, $14_1 = 0, $15_1 = 0, $16_1 = 0, $17_1 = 0, $18_1 = 0, $19_1 = 0, $20_1 = 0, $21_1 = 0, $22_1 = 0, $23_1 = 0, $24_1 = 0, $25_1 = 0, $26_1 = 0, $27_1 = 0, $28_1 = 0, $29_1 = 0, $30_1 = 0, $31_1 = 0, $32_1 = 0, $33_1 = 0, $34_1 = 0, $35_1 = 0, $36_1 = 0, $37_1 = 0, $38_1 = 0, $39_1 = 0, $40_1 = 0, $41_1 = 0, $42_1 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $93 = 0, $131 = 0;
  block : {
   $8_1 = HEAP32[($0_1 + 48 | 0) >> 2] | 0;
   $7_1 = $8_1 + Math_imul($1_1 - $2_1 | 0, 48) | 0;
   $6_1 = HEAP32[($7_1 + 12 | 0) >> 2] | 0;
   $4_1 = (((HEAP32[($7_1 + 16 | 0) >> 2] | 0) - $6_1 | 0) >>> 0) / ((HEAP32[($7_1 + 8 | 0) >> 2] | 0) >>> 0) | 0;
   $93 = ($2_1 | 0) < (0 | 0) ? ($4_1 << 1 | 0) - 480 | 0 : ($4_1 - 240 | 0) >> $2_1 | 0;
   $5_1 = $8_1 + Math_imul($1_1, 48) | 0;
   $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
   $9_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
   $10_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
   $8_1 = ((($4_1 - $9_1 | 0) >>> 0) / ($10_1 >>> 0) | 0) - (HEAP32[($5_1 + 40 | 0) >> 2] | 0) | 0;
   $11_1 = $93 - $8_1 | 0;
   if (($11_1 | 0) <= (0 | 0)) {
    break block
   }
   $131 = ((HEAP32[$7_1 >> 2] | 0) + $6_1 | 0) + ((($2_1 | 0) > (0 | 0) ? $8_1 << $2_1 | 0 : $8_1 >> (0 - $2_1 | 0) | 0) << 2 | 0) | 0;
   block2 : {
    if (($4_1 | 0) == ($9_1 | 0)) {
     i64toi32_i32$0 = 0;
     HEAP32[($5_1 + 12 | 0) >> 2] = 0;
     HEAP32[($5_1 + 16 | 0) >> 2] = i64toi32_i32$0;
     $4_1 = 0;
    }
    $7_1 = Math_imul($10_1, $11_1);
    $9_1 = $7_1 + $4_1 | 0;
    $2_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
    if ($9_1 >>> 0 > $2_1 >>> 0) {
     label : while (1) {
      $8_1 = HEAP32[$5_1 >> 2] | 0;
      block1 : {
       $6_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
       if ($6_1 >>> 0 >= 32769 >>> 0) {
        $2_1 = $4_1 - $6_1 | 0;
        if ($2_1) {
         $41($8_1 | 0, $6_1 + $8_1 | 0 | 0, $2_1 | 0)
        }
        $2_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
        HEAP32[($5_1 + 12 | 0) >> 2] = 0;
        $4_1 = (HEAP32[($5_1 + 16 | 0) >> 2] | 0) - $2_1 | 0;
        HEAP32[($5_1 + 16 | 0) >> 2] = $4_1;
        $2_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
        break block1;
       }
       $8_1 = $9($8_1 | 0, $2_1 + $7_1 | 0 | 0) | 0;
       HEAP32[$5_1 >> 2] = $8_1;
       $2_1 = (HEAP32[($5_1 + 4 | 0) >> 2] | 0) + $7_1 | 0;
       HEAP32[($5_1 + 4 | 0) >> 2] = $2_1;
       $188 = 0;
       if (!$8_1) {
        break block2
       }
       $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
      }
      $9_1 = $4_1 + $7_1 | 0;
      if ($9_1 >>> 0 > $2_1 >>> 0) {
       continue label
      }
      break label;
     }
    }
    HEAP32[($5_1 + 16 | 0) >> 2] = $9_1;
    $188 = (HEAP32[$5_1 >> 2] | 0) + $4_1 | 0;
   }
   $8_1 = $188;
   $4_1 = $131 + 480 | 0;
   block3 : {
    if (($1_1 | 0) < (0 | 0)) {
     $2_1 = 0;
     label1 : while (1) {
      $1_1 = $8_1 + ($2_1 << 2 | 0) | 0;
      $3_1 = $4_1 - 236 | 0;
      $7_1 = $4_1 - 232 | 0;
      $6_1 = $4_1 - 228 | 0;
      $9_1 = $4_1 - 224 | 0;
      $10_1 = $4_1 - 220 | 0;
      $12_1 = $4_1 - 216 | 0;
      $13_1 = $4_1 - 212 | 0;
      $14_1 = $4_1 - 208 | 0;
      $15_1 = $4_1 - 204 | 0;
      $16_1 = $4_1 - 200 | 0;
      $17_1 = $4_1 - 196 | 0;
      $18_1 = $4_1 - 192 | 0;
      $19_1 = $4_1 - 188 | 0;
      $20_1 = $4_1 - 184 | 0;
      $21_1 = $4_1 - 180 | 0;
      $22_1 = $4_1 - 176 | 0;
      $23_1 = $4_1 - 172 | 0;
      $24_1 = $4_1 - 168 | 0;
      $25_1 = $4_1 - 164 | 0;
      $26_1 = $4_1 - 160 | 0;
      $27_1 = $4_1 - 156 | 0;
      $28_1 = $4_1 - 152 | 0;
      $29_1 = $4_1 - 148 | 0;
      $30_1 = $4_1 - 144 | 0;
      $31_1 = $4_1 - 140 | 0;
      $32_1 = $4_1 - 136 | 0;
      $33_1 = $4_1 - 132 | 0;
      $34_1 = $4_1 - 128 | 0;
      $35_1 = $4_1 - 124 | 0;
      $36_1 = $4_1 - 120 | 0;
      $37_1 = $4_1 - 116 | 0;
      $38_1 = $4_1 - 112 | 0;
      $39_1 = $4_1 - 108 | 0;
      $40_1 = $4_1 - 104 | 0;
      $41_1 = $4_1 - 100 | 0;
      $42_1 = $4_1 - 96 | 0;
      $43 = $4_1 - 92 | 0;
      $44 = $4_1 - 88 | 0;
      $45 = $4_1 - 84 | 0;
      $46 = $4_1 - 80 | 0;
      $47 = $4_1 - 76 | 0;
      $48 = $4_1 - 72 | 0;
      $49 = $4_1 - 68 | 0;
      $50 = $4_1 + -64 | 0;
      $51 = $4_1 - 60 | 0;
      $52 = $4_1 - 56 | 0;
      $53 = $4_1 - 52 | 0;
      $54 = $4_1 - 48 | 0;
      $55 = $4_1 - 44 | 0;
      $56 = $4_1 - 40 | 0;
      $57 = $4_1 - 36 | 0;
      $58 = $4_1 - 32 | 0;
      $59 = $4_1 - 28 | 0;
      $60 = $4_1 - 24 | 0;
      $61 = $4_1 - 20 | 0;
      $62 = $4_1 - 16 | 0;
      $63 = $4_1 - 12 | 0;
      $64 = $4_1 - 8 | 0;
      $65 = $4_1 - 4 | 0;
      $66 = Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 240 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 240 | 0) >> 2])) * Math_fround(-5.285501174512319e-07)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$3_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 236 | 0) >> 2])) * Math_fround(1.9846236682496965e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$7_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 232 | 0) >> 2])) * Math_fround(2.071333619824145e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$6_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 228 | 0) >> 2])) * Math_fround(-2.099097218888346e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$9_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 224 | 0) >> 2])) * Math_fround(2.5132903829216957e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$10_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 220 | 0) >> 2])) * Math_fround(-3.0302720915642567e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$12_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 216 | 0) >> 2])) * Math_fround(3.460905281826854e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$13_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 212 | 0) >> 2])) * Math_fround(-3.644624666776508e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$14_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 208 | 0) >> 2])) * Math_fround(3.427757474128157e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$15_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 204 | 0) >> 2])) * Math_fround(-2.6592530048219487e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$16_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 200 | 0) >> 2])) * Math_fround(1.2001512914139312e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$17_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 196 | 0) >> 2])) * Math_fround(1.0650508556864224e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$18_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 192 | 0) >> 2])) * Math_fround(-4.212080602883361e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$19_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 188 | 0) >> 2])) * Math_fround(8.260905451606959e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$20_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 184 | 0) >> 2])) * Math_fround(-1.3158794899936765e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$21_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 180 | 0) >> 2])) * Math_fround(1.876626629382372e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$22_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 176 | 0) >> 2])) * Math_fround(-2.484566066414118e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$23_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 172 | 0) >> 2])) * Math_fround(3.105540235992521e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$24_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 168 | 0) >> 2])) * Math_fround(-3.6950051435269415e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$25_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 164 | 0) >> 2])) * Math_fround(4.1988398879766464e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$26_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 160 | 0) >> 2])) * Math_fround(-4.554950864985585e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$27_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 156 | 0) >> 2])) * Math_fround(4.695796815212816e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$28_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 152 | 0) >> 2])) * Math_fround(-4.551744495984167e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$29_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 148 | 0) >> 2])) * Math_fround(4.0552602149546146e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$30_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 144 | 0) >> 2])) * Math_fround(-3.145730006508529e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$31_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 140 | 0) >> 2])) * Math_fround(1.774780248524621e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$32_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 136 | 0) >> 2])) * Math_fround(8.821186384011526e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$33_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 132 | 0) >> 2])) * Math_fround(-2.4506778572686017e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$34_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 128 | 0) >> 2])) * Math_fround(5.291844718158245e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$35_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 124 | 0) >> 2])) * Math_fround(-8.558491826988757e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$36_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 120 | 0) >> 2])) * Math_fround(1.2161827180534601e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$37_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 116 | 0) >> 2])) * Math_fround(-1.5975796850398183e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$38_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 112 | 0) >> 2])) * Math_fround(1.9837121944874525e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$39_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 108 | 0) >> 2])) * Math_fround(-2.3547252640128136e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$40_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 104 | 0) >> 2])) * Math_fround(.00268763629719615)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$41_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 100 | 0) >> 2])) * Math_fround(-.002956943353638053)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$42_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 96 | 0) >> 2])) * Math_fround(.003135429695248604)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$43 >> 2]) + Math_fround(HEAPF32[($4_1 + 92 | 0) >> 2])) * Math_fround(-3.1951467972248793e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$44 >> 2]) + Math_fround(HEAPF32[($4_1 + 88 | 0) >> 2])) * Math_fround(3.1085426453500986e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$45 >> 2]) + Math_fround(HEAPF32[($4_1 + 84 | 0) >> 2])) * Math_fround(-2.8496927116066217e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$46 >> 2]) + Math_fround(HEAPF32[($4_1 + 80 | 0) >> 2])) * Math_fround(.00239558145403862)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$47 >> 2]) + Math_fround(HEAPF32[($4_1 + 76 | 0) >> 2])) * Math_fround(-1.7273786943405867e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$48 >> 2]) + Math_fround(HEAPF32[($4_1 + 72 | 0) >> 2])) * Math_fround(8.316441089846194e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$49 >> 2]) + Math_fround(HEAPF32[($4_1 + 68 | 0) >> 2])) * Math_fround(2.985988394357264e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$50 >> 2]) + Math_fround(HEAPF32[($4_1 + 64 | 0) >> 2])) * Math_fround(-1.6629844903945923e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$51 >> 2]) + Math_fround(HEAPF32[($4_1 + 60 | 0) >> 2])) * Math_fround(.003253171220421791)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$52 >> 2]) + Math_fround(HEAPF32[($4_1 + 56 | 0) >> 2])) * Math_fround(-.005052506923675537)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$53 >> 2]) + Math_fround(HEAPF32[($4_1 + 52 | 0) >> 2])) * Math_fround(.007036016788333654)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$54 >> 2]) + Math_fround(HEAPF32[($4_1 + 48 | 0) >> 2])) * Math_fround(-.009170744568109512)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$55 >> 2]) + Math_fround(HEAPF32[($4_1 + 44 | 0) >> 2])) * Math_fround(.011416441760957241)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$56 >> 2]) + Math_fround(HEAPF32[($4_1 + 40 | 0) >> 2])) * Math_fround(-.013726598583161831)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$57 >> 2]) + Math_fround(HEAPF32[($4_1 + 36 | 0) >> 2])) * Math_fround(.01604977808892727)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$58 >> 2]) + Math_fround(HEAPF32[($4_1 + 32 | 0) >> 2])) * Math_fround(-.018331212922930717)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$59 >> 2]) + Math_fround(HEAPF32[($4_1 + 28 | 0) >> 2])) * Math_fround(.020514609292149544)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$60 >> 2]) + Math_fround(HEAPF32[($4_1 + 24 | 0) >> 2])) * Math_fround(-.022544067353010178)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$61 >> 2]) + Math_fround(HEAPF32[($4_1 + 20 | 0) >> 2])) * Math_fround(.02436605468392372)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$62 >> 2]) + Math_fround(HEAPF32[($4_1 + 16 | 0) >> 2])) * Math_fround(-.025931356474757195)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$63 >> 2]) + Math_fround(HEAPF32[($4_1 + 12 | 0) >> 2])) * Math_fround(.02719687670469284)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$64 >> 2]) + Math_fround(HEAPF32[($4_1 + 8 | 0) >> 2])) * Math_fround(-.02812729775905609)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$65 >> 2]) + Math_fround(HEAPF32[($4_1 + 4 | 0) >> 2])) * Math_fround(.028696339577436447)) + Math_fround(Math_fround(HEAPF32[$4_1 >> 2]) * Math_fround(.4711121618747711))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))));
      HEAPF32[$1_1 >> 2] = Math_fround($66 + $66);
      $66 = Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$3_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 240 | 0) >> 2])) * Math_fround(4.903286480839597e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$7_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 236 | 0) >> 2])) * Math_fround(3.206084875273518e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$6_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 232 | 0) >> 2])) * Math_fround(-9.387523277837317e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$9_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 228 | 0) >> 2])) * Math_fround(3.661579967229045e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$10_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 224 | 0) >> 2])) * Math_fround(2.735620000748895e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$12_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 220 | 0) >> 2])) * Math_fround(-1.2107811016903725e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$13_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 216 | 0) >> 2])) * Math_fround(2.4965425836853683e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$14_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 212 | 0) >> 2])) * Math_fround(-4.119111690670252e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$15_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 208 | 0) >> 2])) * Math_fround(6.0210157244000584e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$16_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 204 | 0) >> 2])) * Math_fround(-8.095589146250859e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$17_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 200 | 0) >> 2])) * Math_fround(1.0185818973695859e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$18_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 196 | 0) >> 2])) * Math_fround(-1.2083091860404238e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$19_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 192 | 0) >> 2])) * Math_fround(1.3531804142985493e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$20_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 188 | 0) >> 2])) * Math_fround(-1.4237486175261438e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$21_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 184 | 0) >> 2])) * Math_fround(1.388132368447259e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$22_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 180 | 0) >> 2])) * Math_fround(-1.2138997408328578e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$23_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 176 | 0) >> 2])) * Math_fround(8.705004438525066e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$24_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 172 | 0) >> 2])) * Math_fround(-3.320208270451985e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$25_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 168 | 0) >> 2])) * Math_fround(-4.197535236016847e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$26_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 164 | 0) >> 2])) * Math_fround(1.392226986354217e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$27_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 160 | 0) >> 2])) * Math_fround(-2.578958810772747e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$28_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 156 | 0) >> 2])) * Math_fround(3.956986765842885e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$29_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 152 | 0) >> 2])) * Math_fround(-5.484704161062837e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$30_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 148 | 0) >> 2])) * Math_fround(7.100555812940001e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$31_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 144 | 0) >> 2])) * Math_fround(-8.722752681933343e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$32_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 140 | 0) >> 2])) * Math_fround(1.0250204941257834e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$33_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 136 | 0) >> 2])) * Math_fround(-1.1564798187464476e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$34_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 132 | 0) >> 2])) * Math_fround(1.2535087298601866e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$35_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 128 | 0) >> 2])) * Math_fround(-1.3021404156461358e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$36_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 124 | 0) >> 2])) * Math_fround(1.2882278533652425e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$37_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 120 | 0) >> 2])) * Math_fround(-1.1982021387666464e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$38_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 116 | 0) >> 2])) * Math_fround(1.0199174284934998e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$39_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 112 | 0) >> 2])) * Math_fround(-7.435525767505169e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$40_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 108 | 0) >> 2])) * Math_fround(3.625278768595308e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$41_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 104 | 0) >> 2])) * Math_fround(1.256073301192373e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$42_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 100 | 0) >> 2])) * Math_fround(-7.183619309216738e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$43 >> 2]) + Math_fround(HEAPF32[($4_1 + 96 | 0) >> 2])) * Math_fround(1.4076106017455459e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$44 >> 2]) + Math_fround(HEAPF32[($4_1 + 92 | 0) >> 2])) * Math_fround(-2.1790650207549334e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$45 >> 2]) + Math_fround(HEAPF32[($4_1 + 88 | 0) >> 2])) * Math_fround(.003011940745636821)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$46 >> 2]) + Math_fround(HEAPF32[($4_1 + 84 | 0) >> 2])) * Math_fround(-3.8788490928709507e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$47 >> 2]) + Math_fround(HEAPF32[($4_1 + 80 | 0) >> 2])) * Math_fround(.004745918326079845)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$48 >> 2]) + Math_fround(HEAPF32[($4_1 + 76 | 0) >> 2])) * Math_fround(-.005573143716901541)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$49 >> 2]) + Math_fround(HEAPF32[($4_1 + 72 | 0) >> 2])) * Math_fround(.006314937025308609)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$50 >> 2]) + Math_fround(HEAPF32[($4_1 + 68 | 0) >> 2])) * Math_fround(-.006920820102095604)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$51 >> 2]) + Math_fround(HEAPF32[($4_1 + 64 | 0) >> 2])) * Math_fround(.007336183451116085)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$52 >> 2]) + Math_fround(HEAPF32[($4_1 + 60 | 0) >> 2])) * Math_fround(-.007502982392907143)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$53 >> 2]) + Math_fround(HEAPF32[($4_1 + 56 | 0) >> 2])) * Math_fround(.007360189221799374)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$54 >> 2]) + Math_fround(HEAPF32[($4_1 + 52 | 0) >> 2])) * Math_fround(-.006843729875981808)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$55 >> 2]) + Math_fround(HEAPF32[($4_1 + 48 | 0) >> 2])) * Math_fround(5.8854869566857815e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$56 >> 2]) + Math_fround(HEAPF32[($4_1 + 44 | 0) >> 2])) * Math_fround(-.004410688299685717)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$57 >> 2]) + Math_fround(HEAPF32[($4_1 + 40 | 0) >> 2])) * Math_fround(2.3324829526245594e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$58 >> 2]) + Math_fround(HEAPF32[($4_1 + 36 | 0) >> 2])) * Math_fround(4.585253482218832e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$59 >> 2]) + Math_fround(HEAPF32[($4_1 + 32 | 0) >> 2])) * Math_fround(-.004114341922104359)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$60 >> 2]) + Math_fround(HEAPF32[($4_1 + 28 | 0) >> 2])) * Math_fround(.008869274519383907)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$61 >> 2]) + Math_fround(HEAPF32[($4_1 + 24 | 0) >> 2])) * Math_fround(-.015123856253921986)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$62 >> 2]) + Math_fround(HEAPF32[($4_1 + 20 | 0) >> 2])) * Math_fround(.023641161620616913)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$63 >> 2]) + Math_fround(HEAPF32[($4_1 + 16 | 0) >> 2])) * Math_fround(-.03607959300279617)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$64 >> 2]) + Math_fround(HEAPF32[($4_1 + 12 | 0) >> 2])) * Math_fround(.05680295452475548)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$65 >> 2]) + Math_fround(HEAPF32[($4_1 + 8 | 0) >> 2])) * Math_fround(-.10192703455686569)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[$4_1 >> 2]) + Math_fround(HEAPF32[($4_1 + 4 | 0) >> 2])) * Math_fround(.3169075548648834)) + Math_fround(0.0)))))))))))))))))))))))))))))))))))))))))))))))))))))))))))));
      HEAPF32[($1_1 + 4 | 0) >> 2] = Math_fround($66 + $66);
      $4_1 = $4_1 + 4 | 0;
      $2_1 = $2_1 + 2 | 0;
      if (($2_1 | 0) < ($11_1 | 0)) {
       continue label1
      }
      break label1;
     };
     break block3;
    }
    $7_1 = HEAP32[($0_1 + 24 | 0) >> 2] | 0;
    block4 : {
     $10_1 = HEAP32[($5_1 + 36 | 0) >> 2] | 0;
     if (!$10_1) {
      $2_1 = 0;
      if (($1_1 | 0) != (HEAP32[($0_1 + 28 | 0) >> 2] | 0 | 0)) {
       break block4
      }
      HEAP32[($0_1 + 28 | 0) >> 2] = 0;
      $6_1 = ($7_1 | 0) != (0 | 0);
      if (($6_1 | 0) == (HEAP32[($5_1 + 32 | 0) >> 2] | 0 | 0)) {
       break block4
      }
      HEAP32[($5_1 + 32 | 0) >> 2] = $6_1;
      HEAP32[($5_1 + 36 | 0) >> 2] = 512;
      HEAP32[($0_1 + 20 | 0) >> 2] = (HEAP32[($0_1 + 20 | 0) >> 2] | 0) + 1 | 0;
      $10_1 = 512;
     }
     $12_1 = ($10_1 | 0) > ($11_1 | 0) ? $11_1 : $10_1;
     $6_1 = ($10_1 << 3 | 0) + 73728 | 0;
     $9_1 = ((0 - ($10_1 << 1 | 0) | 0) << 2 | 0) + 77824 | 0;
     block5 : {
      if (!$7_1) {
       $2_1 = 0;
       if (($10_1 | 0) <= (0 | 0)) {
        break block5
       }
       $7_1 = $8_1;
       label2 : while (1) {
        HEAPF32[$7_1 >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[$9_1 >> 2]) * Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 44 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 44 | 0) >> 2])) * Math_fround(-3.4689533640630543e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 36 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 36 | 0) >> 2])) * Math_fround(2.5129318237304688e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 28 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 28 | 0) >> 2])) * Math_fround(-.010158222168684006)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 20 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 20 | 0) >> 2])) * Math_fround(.03055134415626526)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 12 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 12 | 0) >> 2])) * Math_fround(-.08198054134845734)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 4 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 4 | 0) >> 2])) * Math_fround(.3094184696674347)) + Math_fround(Math_fround(HEAPF32[$4_1 >> 2]) * Math_fround(.5))))))))) + Math_fround(Math_fround(HEAPF32[$6_1 >> 2]) * Math_fround($27($4_1 | 0))));
        $4_1 = $4_1 + 8 | 0;
        $7_1 = $7_1 + 4 | 0;
        $6_1 = $6_1 - 8 | 0;
        $9_1 = $9_1 + 8 | 0;
        $2_1 = $2_1 + 1 | 0;
        if (($2_1 | 0) < ($12_1 | 0)) {
         continue label2
        }
        break label2;
       };
       break block5;
      }
      $2_1 = 0;
      if (($10_1 | 0) <= (0 | 0)) {
       break block5
      }
      $7_1 = $8_1;
      label3 : while (1) {
       HEAPF32[$7_1 >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[$6_1 >> 2]) * Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 44 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 44 | 0) >> 2])) * Math_fround(-3.4689533640630543e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 36 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 36 | 0) >> 2])) * Math_fround(2.5129318237304688e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 28 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 28 | 0) >> 2])) * Math_fround(-.010158222168684006)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 20 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 20 | 0) >> 2])) * Math_fround(.03055134415626526)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 12 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 12 | 0) >> 2])) * Math_fround(-.08198054134845734)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 4 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 4 | 0) >> 2])) * Math_fround(.3094184696674347)) + Math_fround(Math_fround(HEAPF32[$4_1 >> 2]) * Math_fround(.5))))))))) + Math_fround(Math_fround(HEAPF32[$9_1 >> 2]) * Math_fround($27($4_1 | 0))));
       $4_1 = $4_1 + 8 | 0;
       $7_1 = $7_1 + 4 | 0;
       $6_1 = $6_1 - 8 | 0;
       $9_1 = $9_1 + 8 | 0;
       $2_1 = $2_1 + 1 | 0;
       if (($2_1 | 0) < ($12_1 | 0)) {
        continue label3
       }
       break label3;
      };
     }
     HEAP32[($5_1 + 36 | 0) >> 2] = $10_1 - $12_1 | 0;
     HEAP32[($0_1 + 20 | 0) >> 2] = (HEAP32[($0_1 + 20 | 0) >> 2] | 0) - (($10_1 | 0) <= ($11_1 | 0)) | 0;
    }
    if (($1_1 | 0) >= ($3_1 | 0)) {
     if (($2_1 | 0) >= ($11_1 | 0)) {
      break block3
     }
     $6_1 = $8_1 + ($2_1 << 2 | 0) | 0;
     label4 : while (1) {
      HEAPF32[$6_1 >> 2] = Math_fround($27($4_1 | 0));
      $6_1 = $6_1 + 4 | 0;
      $4_1 = $4_1 + 8 | 0;
      $2_1 = $2_1 + 1 | 0;
      if (($2_1 | 0) < ($11_1 | 0)) {
       continue label4
      }
      break label4;
     };
     break block3;
    }
    if (($2_1 | 0) >= ($11_1 | 0)) {
     break block3
    }
    $6_1 = $8_1 + ($2_1 << 2 | 0) | 0;
    label5 : while (1) {
     HEAPF32[$6_1 >> 2] = Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 44 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 44 | 0) >> 2])) * Math_fround(-3.4689533640630543e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 36 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 36 | 0) >> 2])) * Math_fround(2.5129318237304688e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 28 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 28 | 0) >> 2])) * Math_fround(-.010158222168684006)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 20 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 20 | 0) >> 2])) * Math_fround(.03055134415626526)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 12 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 12 | 0) >> 2])) * Math_fround(-.08198054134845734)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($4_1 - 4 | 0) >> 2]) + Math_fround(HEAPF32[($4_1 + 4 | 0) >> 2])) * Math_fround(.3094184696674347)) + Math_fround(Math_fround(HEAPF32[$4_1 >> 2]) * Math_fround(.5))))))));
     $4_1 = $4_1 + 8 | 0;
     $6_1 = $6_1 + 4 | 0;
     $2_1 = $2_1 + 1 | 0;
     if (($2_1 | 0) < ($11_1 | 0)) {
      continue label5
     }
     break label5;
    };
   }
   if ((HEAP32[($0_1 + 8 | 0) >> 2] | 0 | 0) <= (0 | 0)) {
    break block
   }
   $0_1 = Math_imul(HEAP32[($5_1 + 8 | 0) >> 2] | 0, HEAP32[($5_1 + 40 | 0) >> 2] | 0);
   block7 : {
    $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
    if (($4_1 | 0) == (HEAP32[($5_1 + 12 | 0) >> 2] | 0 | 0)) {
     i64toi32_i32$0 = 0;
     HEAP32[($5_1 + 12 | 0) >> 2] = 0;
     HEAP32[($5_1 + 16 | 0) >> 2] = i64toi32_i32$0;
     $4_1 = 0;
    }
    $9_1 = $0_1 + $4_1 | 0;
    $2_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
    if ($9_1 >>> 0 > $2_1 >>> 0) {
     label6 : while (1) {
      $1_1 = HEAP32[$5_1 >> 2] | 0;
      block6 : {
       $3_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
       if ($3_1 >>> 0 >= 32769 >>> 0) {
        $2_1 = $4_1 - $3_1 | 0;
        if ($2_1) {
         $41($1_1 | 0, $1_1 + $3_1 | 0 | 0, $2_1 | 0)
        }
        $1_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
        HEAP32[($5_1 + 12 | 0) >> 2] = 0;
        $4_1 = (HEAP32[($5_1 + 16 | 0) >> 2] | 0) - $1_1 | 0;
        HEAP32[($5_1 + 16 | 0) >> 2] = $4_1;
        $2_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
        break block6;
       }
       $1_1 = $9($1_1 | 0, $0_1 + $2_1 | 0 | 0) | 0;
       HEAP32[$5_1 >> 2] = $1_1;
       $2_1 = (HEAP32[($5_1 + 4 | 0) >> 2] | 0) + $0_1 | 0;
       HEAP32[($5_1 + 4 | 0) >> 2] = $2_1;
       $1568 = 0;
       if (!$1_1) {
        break block7
       }
       $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
      }
      $9_1 = $0_1 + $4_1 | 0;
      if ($9_1 >>> 0 > $2_1 >>> 0) {
       continue label6
      }
      break label6;
     }
    }
    HEAP32[($5_1 + 16 | 0) >> 2] = $9_1;
    $1568 = (HEAP32[$5_1 >> 2] | 0) + $4_1 | 0;
   }
   $0_1 = (HEAP32[($5_1 + 40 | 0) >> 2] | 0) << 2 | 0;
   if (!$0_1) {
    break block
   }
   $42($1568 | 0, $0_1 | 0);
  }
  return ($11_1 | 0) > (0 | 0) | 0;
 }
 
 function $13($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var $2_1 = 0, $3_1 = Math_fround(0);
  $2_1 = Math_imul($1_1 >>> 22 | 0, 160);
  $3_1 = Math_fround(Math_fround(($1_1 << 10 | 0) >>> 0) * Math_fround(2.3283064365386963e-10));
  return Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77992 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77996 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 76 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77984 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77988 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 72 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77976 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77980 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 68 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77968 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77972 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 64 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77960 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77964 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 60 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77952 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77956 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 56 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77944 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77948 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 52 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77936 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77940 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 48 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77928 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77932 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 44 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77920 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77924 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 40 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77912 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77916 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 36 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77904 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77908 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 32 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77896 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77900 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 28 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77888 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77892 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 24 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77880 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77884 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 20 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77872 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77876 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 16 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77864 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77868 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 12 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77856 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77860 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 8 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77848 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77852 | 0) >> 2])) * Math_fround(HEAPF32[($0_1 + 4 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 77840 | 0) >> 2]) * $3_1) + Math_fround(HEAPF32[($2_1 + 77844 | 0) >> 2])) * Math_fround(HEAPF32[$0_1 >> 2])) + Math_fround(0.0))))))))))))))))))))));
 }
 
 function $14($0_1, $1_1, $2_1, $3_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  var $4_1 = Math_fround(0), $5_1 = Math_fround(0), $6_1 = Math_fround(0), $7_1 = Math_fround(0), $24_1 = Math_fround(0), $35_1 = Math_fround(0), $44 = Math_fround(0), $54 = Math_fround(0), $64 = Math_fround(0), $74 = Math_fround(0), $84 = Math_fround(0), $94 = Math_fround(0), $104 = Math_fround(0), $114 = Math_fround(0), $124 = Math_fround(0), $134 = Math_fround(0), $144 = Math_fround(0);
  if (($3_1 | 0) > (0 | 0)) {
   label : while (1) {
    $4_1 = Math_fround(HEAPF32[($2_1 + 4 | 0) >> 2]);
    $5_1 = Math_fround(HEAPF32[$0_1 >> 2]);
    $7_1 = Math_fround(HEAPF32[$2_1 >> 2]);
    HEAPF32[$0_1 >> 2] = $7_1;
    $6_1 = Math_fround(HEAPF32[($0_1 + 4 | 0) >> 2]);
    HEAPF32[($0_1 + 4 | 0) >> 2] = $4_1;
    $24_1 = $5_1;
    $5_1 = Math_fround(HEAPF32[($0_1 + 12 | 0) >> 2]);
    $7_1 = Math_fround($24_1 + Math_fround(Math_fround($7_1 - $5_1) * Math_fround(.09983104467391968)));
    HEAPF32[($0_1 + 12 | 0) >> 2] = $7_1;
    $35_1 = $4_1;
    $4_1 = Math_fround(HEAPF32[($0_1 + 8 | 0) >> 2]);
    $6_1 = Math_fround($6_1 + Math_fround(Math_fround($35_1 - $4_1) * Math_fround(.02628520503640175)));
    HEAPF32[($0_1 + 8 | 0) >> 2] = $6_1;
    $44 = $5_1;
    $5_1 = Math_fround(HEAPF32[($0_1 + 20 | 0) >> 2]);
    $7_1 = Math_fround($44 + Math_fround(Math_fround($7_1 - $5_1) * Math_fround(.3302241265773773)));
    HEAPF32[($0_1 + 20 | 0) >> 2] = $7_1;
    $54 = $4_1;
    $4_1 = Math_fround(HEAPF32[($0_1 + 16 | 0) >> 2]);
    $6_1 = Math_fround($54 + Math_fround(Math_fround($6_1 - $4_1) * Math_fround(.20686505734920502)));
    HEAPF32[($0_1 + 16 | 0) >> 2] = $6_1;
    $64 = $5_1;
    $5_1 = Math_fround(HEAPF32[($0_1 + 28 | 0) >> 2]);
    $7_1 = Math_fround($64 + Math_fround(Math_fround($7_1 - $5_1) * Math_fround(.5685783624649048)));
    HEAPF32[($0_1 + 28 | 0) >> 2] = $7_1;
    $74 = $4_1;
    $4_1 = Math_fround(HEAPF32[($0_1 + 24 | 0) >> 2]);
    $6_1 = Math_fround($74 + Math_fround(Math_fround($6_1 - $4_1) * Math_fround(.4544203579425812)));
    HEAPF32[($0_1 + 24 | 0) >> 2] = $6_1;
    $84 = $4_1;
    $4_1 = Math_fround(HEAPF32[($0_1 + 32 | 0) >> 2]);
    $6_1 = Math_fround($84 + Math_fround(Math_fround($6_1 - $4_1) * Math_fround(.6669444441795349)));
    HEAPF32[($0_1 + 32 | 0) >> 2] = $6_1;
    $94 = $5_1;
    $5_1 = Math_fround(HEAPF32[($0_1 + 36 | 0) >> 2]);
    $7_1 = Math_fround($94 + Math_fround(Math_fround($7_1 - $5_1) * Math_fround(.7478697896003723)));
    HEAPF32[($0_1 + 36 | 0) >> 2] = $7_1;
    $104 = $4_1;
    $4_1 = Math_fround(HEAPF32[($0_1 + 40 | 0) >> 2]);
    $6_1 = Math_fround($104 + Math_fround(Math_fround($6_1 - $4_1) * Math_fround(.8123244047164917)));
    HEAPF32[($0_1 + 40 | 0) >> 2] = $6_1;
    $114 = $5_1;
    $5_1 = Math_fround(HEAPF32[($0_1 + 44 | 0) >> 2]);
    $7_1 = Math_fround($114 + Math_fround(Math_fround($7_1 - $5_1) * Math_fround(.8626000881195068)));
    HEAPF32[($0_1 + 44 | 0) >> 2] = $7_1;
    $124 = $4_1;
    $4_1 = Math_fround(HEAPF32[($0_1 + 48 | 0) >> 2]);
    $6_1 = Math_fround($124 + Math_fround(Math_fround($6_1 - $4_1) * Math_fround(.9014277458190918)));
    HEAPF32[($0_1 + 48 | 0) >> 2] = $6_1;
    $134 = $5_1;
    $5_1 = Math_fround(HEAPF32[($0_1 + 52 | 0) >> 2]);
    $7_1 = Math_fround($134 + Math_fround(Math_fround($7_1 - $5_1) * Math_fround(.9314860701560974)));
    HEAPF32[($0_1 + 52 | 0) >> 2] = $7_1;
    $144 = $4_1;
    $4_1 = Math_fround(HEAPF32[($0_1 + 56 | 0) >> 2]);
    $6_1 = Math_fround($144 + Math_fround(Math_fround($6_1 - $4_1) * Math_fround(.9551915526390076)));
    HEAPF32[($0_1 + 56 | 0) >> 2] = $6_1;
    $5_1 = Math_fround($5_1 + Math_fround(Math_fround($7_1 - Math_fround(HEAPF32[($0_1 + 60 | 0) >> 2])) * Math_fround(.9746617674827576)));
    HEAPF32[($0_1 + 60 | 0) >> 2] = $5_1;
    $4_1 = Math_fround($4_1 + Math_fround(Math_fround($6_1 - Math_fround(HEAPF32[($0_1 + 64 | 0) >> 2])) * Math_fround(.9917762875556946)));
    HEAPF32[($0_1 + 64 | 0) >> 2] = $4_1;
    HEAPF32[$1_1 >> 2] = Math_fround($5_1 + $4_1);
    $2_1 = $2_1 + 8 | 0;
    $1_1 = $1_1 + 4 | 0;
    $3_1 = $3_1 - 1 | 0;
    if ($3_1) {
     continue label
    }
    break label;
   }
  }
 }
 
 function $15($0_1, $1_1, $2_1, $3_1, $4_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  var $5_1 = 0, i64toi32_i32$0 = 0, i64toi32_i32$2 = 0, i64toi32_i32$5 = 0, $11_1 = Math_fround(0), i64toi32_i32$4 = 0, i64toi32_i32$1 = 0, i64toi32_i32$3 = 0, $12$hi = 0, $10_1 = 0, $12_1 = 0, $28_1 = 0, $6_1 = 0, $7_1 = 0, $8_1 = 0, $9_1 = 0, $180 = 0, $185 = 0, $185$hi = 0, $13_1 = 0, $13$hi = 0, $188 = 0, $191 = 0, $191$hi = 0;
  block : {
   if (($4_1 | 0) <= (0 | 0)) {
    break block
   }
   $7_1 = (HEAP32[($0_1 + 24 | 0) >> 2] | 0) - 20 | 0;
   $8_1 = $2_1 << 2 | 0;
   $5_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
   $9_1 = HEAP32[($0_1 + 28 | 0) >> 2] | 0;
   label : while (1) {
    if (($5_1 | 0) >= ($9_1 | 0)) {
     break block
    }
    $10_1 = HEAP32[$0_1 >> 2] | 0;
    $2_1 = Math_imul($10_1 >>> 23 | 0, 96);
    $11_1 = Math_fround(Math_fround(($10_1 << 9 | 0) >>> 0) * Math_fround(2.3283064365386963e-10));
    $5_1 = $7_1 + ($5_1 << 2 | 0) | 0;
    HEAPF32[$3_1 >> 2] = Math_fround(Math_fround(Math_fround(HEAPF32[$1_1 >> 2]) * Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241768 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241772 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 44 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241760 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241764 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 40 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241752 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241756 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 36 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241744 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241748 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 32 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241736 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241740 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 28 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241728 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241732 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 24 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241720 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241724 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 20 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241712 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241716 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 16 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241704 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241708 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 12 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241696 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241700 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 8 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241688 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241692 | 0) >> 2])) * Math_fround(HEAPF32[($5_1 + 4 | 0) >> 2])) + Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($2_1 + 241680 | 0) >> 2]) * $11_1) + Math_fround(HEAPF32[($2_1 + 241684 | 0) >> 2])) * Math_fround(HEAPF32[$5_1 >> 2])) + Math_fround(0.0)))))))))))))) + Math_fround(HEAPF32[$3_1 >> 2]));
    $180 = $0_1;
    i64toi32_i32$2 = $0_1;
    i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 8 | 0) >> 2] | 0;
    i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 12 | 0) >> 2] | 0;
    $12_1 = i64toi32_i32$0;
    $12$hi = i64toi32_i32$1;
    i64toi32_i32$1 = HEAP32[i64toi32_i32$2 >> 2] | 0;
    i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
    $185 = i64toi32_i32$1;
    $185$hi = i64toi32_i32$0;
    i64toi32_i32$0 = $12$hi;
    i64toi32_i32$2 = $12_1;
    i64toi32_i32$1 = $185$hi;
    i64toi32_i32$3 = $185;
    i64toi32_i32$4 = i64toi32_i32$2 + i64toi32_i32$3 | 0;
    i64toi32_i32$5 = i64toi32_i32$0 + i64toi32_i32$1 | 0;
    if (i64toi32_i32$4 >>> 0 < i64toi32_i32$3 >>> 0) {
     i64toi32_i32$5 = i64toi32_i32$5 + 1 | 0
    }
    $13_1 = i64toi32_i32$4;
    $13$hi = i64toi32_i32$5;
    i64toi32_i32$2 = $180;
    HEAP32[i64toi32_i32$2 >> 2] = i64toi32_i32$4;
    HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] = i64toi32_i32$5;
    $188 = $0_1;
    i64toi32_i32$5 = $12$hi;
    i64toi32_i32$0 = $0_1;
    i64toi32_i32$5 = HEAP32[(i64toi32_i32$0 + 16 | 0) >> 2] | 0;
    i64toi32_i32$2 = HEAP32[(i64toi32_i32$0 + 20 | 0) >> 2] | 0;
    $191 = i64toi32_i32$5;
    $191$hi = i64toi32_i32$2;
    i64toi32_i32$2 = $12$hi;
    i64toi32_i32$0 = $12_1;
    i64toi32_i32$5 = $191$hi;
    i64toi32_i32$3 = $191;
    i64toi32_i32$1 = i64toi32_i32$0 + i64toi32_i32$3 | 0;
    i64toi32_i32$4 = i64toi32_i32$2 + i64toi32_i32$5 | 0;
    if (i64toi32_i32$1 >>> 0 < i64toi32_i32$3 >>> 0) {
     i64toi32_i32$4 = i64toi32_i32$4 + 1 | 0
    }
    i64toi32_i32$0 = $188;
    HEAP32[(i64toi32_i32$0 + 8 | 0) >> 2] = i64toi32_i32$1;
    HEAP32[(i64toi32_i32$0 + 12 | 0) >> 2] = i64toi32_i32$4;
    $3_1 = $3_1 + 8 | 0;
    $1_1 = $1_1 + $8_1 | 0;
    i64toi32_i32$4 = $13$hi;
    i64toi32_i32$2 = $13_1;
    i64toi32_i32$0 = 0;
    i64toi32_i32$3 = 32;
    i64toi32_i32$5 = i64toi32_i32$3 & 31 | 0;
    if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
     i64toi32_i32$0 = 0;
     $28_1 = i64toi32_i32$4 >>> i64toi32_i32$5 | 0;
    } else {
     i64toi32_i32$0 = i64toi32_i32$4 >>> i64toi32_i32$5 | 0;
     $28_1 = (((1 << i64toi32_i32$5 | 0) - 1 | 0) & i64toi32_i32$4 | 0) << (32 - i64toi32_i32$5 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$5 | 0) | 0;
    }
    $5_1 = $28_1;
    $6_1 = $6_1 + 2 | 0;
    if (($6_1 | 0) < ($4_1 | 0)) {
     continue label
    }
    break label;
   };
  }
 }
 
 function $16($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $3_1 = 0, $4_1 = 0, $50 = 0, $5_1 = 0, $39_1 = 0;
  $5_1 = $2_1;
  $2_1 = HEAP32[$2_1 >> 2] | 0;
  $3_1 = (((HEAP32[($0_1 + 68 | 0) >> 2] | 0) - (HEAP32[($0_1 + 64 | 0) >> 2] | 0) | 0) >>> 0) / ((HEAP32[($0_1 + 60 | 0) >> 2] | 0) >>> 0) | 0;
  $3_1 = $2_1 >>> 0 < $3_1 >>> 0 ? $2_1 : $3_1;
  HEAP32[$5_1 >> 2] = $3_1;
  $2_1 = 0;
  $3_1 = Math_imul(HEAP32[($0_1 + 60 | 0) >> 2] | 0, $3_1);
  $4_1 = HEAP32[($0_1 + 64 | 0) >> 2] | 0;
  if ($3_1 >>> 0 <= ((HEAP32[($0_1 + 68 | 0) >> 2] | 0) - $4_1 | 0) >>> 0) {
   $2_1 = (HEAP32[($0_1 + 52 | 0) >> 2] | 0) + $4_1 | 0;
   $39_1 = $0_1;
   if ($1_1) {
    if ($3_1) {
     $41($1_1 | 0, $2_1 | 0, $3_1 | 0)
    }
    $50 = HEAP32[($0_1 + 64 | 0) >> 2] | 0;
   } else {
    $50 = $4_1
   }
   HEAP32[($39_1 + 64 | 0) >> 2] = $50 + $3_1 | 0;
  }
  return $2_1 | 0;
 }
 
 function $17($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0, $2_1 = 0, $3_1 = 0, $4_1 = 0, $5_1 = 0, $6_1 = 0, $75 = 0, $17_1 = 0;
  if (!(HEAP32[($0_1 + 8 | 0) >> 2] | 0)) {
   block1 : {
    $1_1 = HEAP32[($0_1 + 48 | 0) >> 2] | 0;
    $5_1 = Math_imul(HEAP32[($1_1 + 8 | 0) >> 2] | 0, HEAP32[($1_1 + 40 | 0) >> 2] | 0);
    $17_1 = $5_1;
    $2_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
    if (($2_1 | 0) == (HEAP32[($1_1 + 12 | 0) >> 2] | 0 | 0)) {
     HEAP32[($1_1 + 12 | 0) >> 2] = 0;
     HEAP32[($1_1 + 16 | 0) >> 2] = 0;
     $2_1 = 0;
    }
    $3_1 = $17_1 + $2_1 | 0;
    $4_1 = HEAP32[($1_1 + 4 | 0) >> 2] | 0;
    if ($3_1 >>> 0 > $4_1 >>> 0) {
     label : while (1) {
      $3_1 = HEAP32[$1_1 >> 2] | 0;
      block : {
       $6_1 = HEAP32[($1_1 + 12 | 0) >> 2] | 0;
       if ($6_1 >>> 0 >= 32769 >>> 0) {
        $2_1 = $2_1 - $6_1 | 0;
        if ($2_1) {
         $41($3_1 | 0, $3_1 + $6_1 | 0 | 0, $2_1 | 0)
        }
        $2_1 = HEAP32[($1_1 + 12 | 0) >> 2] | 0;
        HEAP32[($1_1 + 12 | 0) >> 2] = 0;
        $2_1 = (HEAP32[($1_1 + 16 | 0) >> 2] | 0) - $2_1 | 0;
        HEAP32[($1_1 + 16 | 0) >> 2] = $2_1;
        $4_1 = HEAP32[($1_1 + 4 | 0) >> 2] | 0;
        break block;
       }
       $2_1 = $9($3_1 | 0, $4_1 + $5_1 | 0 | 0) | 0;
       HEAP32[$1_1 >> 2] = $2_1;
       $4_1 = (HEAP32[($1_1 + 4 | 0) >> 2] | 0) + $5_1 | 0;
       HEAP32[($1_1 + 4 | 0) >> 2] = $4_1;
       $75 = 0;
       if (!$2_1) {
        break block1
       }
       $2_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
      }
      $3_1 = $2_1 + $5_1 | 0;
      if ($3_1 >>> 0 > $4_1 >>> 0) {
       continue label
      }
      break label;
     }
    }
    HEAP32[($1_1 + 16 | 0) >> 2] = $3_1;
    $75 = (HEAP32[$1_1 >> 2] | 0) + $2_1 | 0;
   }
   $1_1 = $75;
   $2_1 = (HEAP32[((HEAP32[($0_1 + 48 | 0) >> 2] | 0) + 40 | 0) >> 2] | 0) << 2 | 0;
   if ($2_1) {
    $42($1_1 | 0, $2_1 | 0)
   }
   HEAP32[($0_1 + 8 | 0) >> 2] = (HEAP32[($0_1 + 8 | 0) >> 2] | 0) + 1 | 0;
  }
 }
 
 function $18($0_1) {
  $0_1 = $0_1 | 0;
  var $2_1 = 0, $1_1 = 0;
  $37(HEAP32[($0_1 + 52 | 0) >> 2] | 0 | 0);
  if ((HEAP32[($0_1 + 4 | 0) >> 2] | 0 | 0) >= (0 | 0)) {
   $2_1 = -1;
   $1_1 = -48;
   label : while (1) {
    $37(HEAP32[((HEAP32[($0_1 + 48 | 0) >> 2] | 0) + $1_1 | 0) >> 2] | 0 | 0);
    $1_1 = $1_1 + 48 | 0;
    $2_1 = $2_1 + 1 | 0;
    if (($2_1 | 0) < (HEAP32[($0_1 + 4 | 0) >> 2] | 0 | 0)) {
     continue label
    }
    break label;
   };
  }
  $37((HEAP32[($0_1 + 48 | 0) >> 2] | 0) - 48 | 0 | 0);
 }
 
 function $19($0_1) {
  $0_1 = $0_1 | 0;
  wasm2js_trap();
 }
 
 function $20($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  HEAP32[$0_1 >> 2] = 0;
  HEAP32[$1_1 >> 2] = 240;
 }
 
 function $21($0_1, $1_1, $2_1, $3_1, $4_1, $5_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = +$2_1;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = +$5_1;
  var i64toi32_i32$0 = 0, i64toi32_i32$1 = 0, $6_1 = 0.0, $7_1 = 0;
  $3_1 = 0;
  if ($2_1 > 1.0) {
   $6_1 = $2_1;
   label : while (1) {
    $3_1 = $3_1 + 1 | 0;
    $6_1 = $6_1 * .5;
    if ($6_1 > 1.0) {
     continue label
    }
    break label;
   };
  }
  $42($0_1 + 8 | 0 | 0, 232 | 0);
  $1_1 = ($3_1 | 0) <= (1 | 0) ? 1 : $3_1;
  HEAP32[($0_1 + 4 | 0) >> 2] = $1_1;
  HEAP32[$0_1 >> 2] = $3_1;
  $1_1 = $2($1_1 + 1 | 0 | 0, 48 | 0) | 0;
  i64toi32_i32$1 = $1_1;
  i64toi32_i32$0 = 4;
  HEAP32[($1_1 + 4 | 0) >> 2] = 32768;
  HEAP32[($1_1 + 8 | 0) >> 2] = i64toi32_i32$0;
  HEAP32[($0_1 + 48 | 0) >> 2] = $1_1 + 48 | 0;
  $4_1 = $36(32768 | 0) | 0;
  HEAP32[($1_1 + 32 | 0) >> 2] = 1;
  i64toi32_i32$1 = $1_1;
  i64toi32_i32$0 = 1107296256;
  HEAP32[($1_1 + 24 | 0) >> 2] = 0;
  HEAP32[($1_1 + 28 | 0) >> 2] = i64toi32_i32$0;
  HEAP32[$1_1 >> 2] = $4_1;
  i64toi32_i32$1 = $1_1;
  i64toi32_i32$0 = 4;
  HEAP32[($1_1 + 52 | 0) >> 2] = 32768;
  HEAP32[($1_1 + 56 | 0) >> 2] = i64toi32_i32$0;
  $4_1 = $36(32768 | 0) | 0;
  HEAP32[($1_1 + 88 | 0) >> 2] = 240;
  i64toi32_i32$1 = $1_1;
  i64toi32_i32$0 = 1106247680;
  HEAP32[($1_1 + 72 | 0) >> 2] = 0;
  HEAP32[($1_1 + 76 | 0) >> 2] = i64toi32_i32$0;
  HEAP32[($1_1 + 48 | 0) >> 2] = $4_1;
  HEAP32[($1_1 + 64 | 0) >> 2] = 960;
  $42($4_1 | 0, 960 | 0);
  HEAP32[($1_1 + 80 | 0) >> 2] = 1;
  if ($3_1 >>> 0 >= 2 >>> 0) {
   $4_1 = 1;
   label1 : while (1) {
    i64toi32_i32$1 = $1_1 + 100 | 0;
    i64toi32_i32$0 = 4;
    HEAP32[i64toi32_i32$1 >> 2] = 32768;
    HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
    $7_1 = $36(32768 | 0) | 0;
    HEAP32[($1_1 + 136 | 0) >> 2] = 180;
    HEAPF64[($1_1 + 120 | 0) >> 3] = 8589934592.0 / +(2 << $4_1 | 0 | 0);
    HEAP32[($1_1 + 96 | 0) >> 2] = $7_1;
    i64toi32_i32$1 = $1_1 + 108 | 0;
    i64toi32_i32$0 = 720;
    HEAP32[i64toi32_i32$1 >> 2] = 0;
    HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
    $42($7_1 | 0, 720 | 0);
    HEAP32[($1_1 + 128 | 0) >> 2] = 1;
    $1_1 = $1_1 + 48 | 0;
    $4_1 = $4_1 + 1 | 0;
    if (($3_1 | 0) != ($4_1 | 0)) {
     continue label1
    }
    break label1;
   };
  }
  i64toi32_i32$1 = $0_1;
  i64toi32_i32$0 = 0;
  HEAP32[($0_1 + 64 | 0) >> 2] = 0;
  HEAP32[($0_1 + 68 | 0) >> 2] = i64toi32_i32$0;
  i64toi32_i32$1 = $0_1;
  i64toi32_i32$0 = 4;
  HEAP32[($0_1 + 56 | 0) >> 2] = 32768;
  HEAP32[($0_1 + 60 | 0) >> 2] = i64toi32_i32$0;
  $1_1 = $36(32768 | 0) | 0;
  HEAPF64[($0_1 + 40 | 0) >> 3] = $2_1;
  HEAP32[($0_1 + 52 | 0) >> 2] = $1_1;
  if (Math_fround(HEAPF32[73728 >> 2]) == Math_fround(0.0)) {
   $6_1 = 0.0;
   $1_1 = -4096;
   $3_1 = 0;
   label2 : while (1) {
    HEAPF32[($1_1 + 77824 | 0) >> 2] = Math_fround((+$23(+($6_1 * 3.141592653589793 * .0009765625)) + 1.0) * .5);
    if ($1_1) {
     HEAPF32[($1_1 + 77828 | 0) >> 2] = Math_fround((+$23(+(+(($3_1 | 1 | 0) >>> 0) * 3.141592653589793 * .0009765625)) + 1.0) * .5);
     $1_1 = $1_1 + 8 | 0;
     $3_1 = $3_1 + 2 | 0;
     $6_1 = $6_1 + 2.0;
     continue label2;
    }
    break label2;
   };
   $24(241680 | 0, 12 | 0, 6 | 0, 512 | 0, 65952 | 0, +$5_1);
   $24(77840 | 0, 20 | 0, 12 | 0, 1024 | 0, 66112 | 0, +($5_1 * .5));
  }
  return 0 | 0;
 }
 
 function $22($0_1) {
  $0_1 = $0_1 | 0;
  return $36($0_1 | 0) | 0 | 0;
 }
 
 function $23($5_1) {
  $5_1 = +$5_1;
  var $6_1 = 0, $7_1 = 0, $48 = 0.0, $8_1 = 0, $9_1 = 0, i64toi32_i32$4 = 0, i64toi32_i32$0 = 0, i64toi32_i32$1 = 0, i64toi32_i32$2 = 0, $11_1 = 0, $10_1 = 0, i64toi32_i32$3 = 0, $49 = 0.0, $12_1 = 0, $13_1 = 0, $14_1 = 0, $50 = 0.0, $15_1 = 0, $16_1 = 0, $17_1 = 0, $51 = 0.0, $18_1 = 0, $19_1 = 0, $20_1 = 0, $66 = 0.0, $21_1 = 0, $53 = 0, $53$hi = 0, $22_1 = 0, $1112 = 0.0, $23_1 = 0, $52 = 0.0, $441 = 0.0, $24_1 = 0, $27_1 = 0, $29_1 = 0, $761 = 0, $25_1 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $313 = 0, $340 = 0, $354 = 0, $470 = 0, $478 = 0.0, $26_1 = 0, $28_1 = 0, $30_1 = 0, $31_1 = 0, $34_1 = 0, $32_1 = 0, $42_1 = 0, $43 = 0, $658 = 0, $670 = 0, $686 = 0, $698 = 0, $729 = 0, $741 = 0, $127 = 0, $793 = 0, $823 = 0, $47 = 0, $873 = 0, $898 = 0, $128 = 0, $991 = 0, $129 = 0, $1074 = 0, $1086 = 0, $1096 = 0, $130 = 0, $1157 = 0, $1197 = 0, $1302 = 0, $1492 = 0, $131 = 0, $132 = 0, $133 = 0, $79 = 0.0, $255 = 0, $281 = 0, $330 = 0, $344 = 0, $368 = 0.0, scratch = 0, $427 = 0, $33_1 = 0, $35_1 = 0, $36_1 = 0, $37_1 = 0, $38_1 = 0, $39_1 = 0, $40_1 = 0, $41_1 = 0, $44 = 0, scratch_50 = 0, $650 = 0, $673 = 0, $721 = 0, $774 = 0.0, $787 = 0.0, $805 = 0, $808 = 0, scratch_51 = 0, $46 = 0, $925 = 0.0, $926 = 0.0, $950 = 0, $1053 = 0.0, $1066 = 0, $1130 = 0.0, $1137 = 0, $1414 = 0, $1456 = 0.0, $1515 = 0, scratch_52 = 0, $1681 = 0.0, $1750 = 0.0;
  $14_1 = global$0 - 16 | 0;
  global$0 = $14_1;
  block : {
   wasm2js_scratch_store_f64(+$5_1);
   i64toi32_i32$0 = wasm2js_scratch_load_i32(1 | 0) | 0;
   i64toi32_i32$2 = wasm2js_scratch_load_i32(0 | 0) | 0;
   i64toi32_i32$1 = 0;
   i64toi32_i32$3 = 32;
   i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
   if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
    i64toi32_i32$1 = 0;
    $111 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
   } else {
    i64toi32_i32$1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
    $111 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
   }
   $6_1 = $111 & 2147483647 | 0;
   if ($6_1 >>> 0 <= 1072243195 >>> 0) {
    $66 = 1.0;
    if ($6_1 >>> 0 < 1044816030 >>> 0) {
     break block
    }
    $48 = $5_1 * $5_1;
    $49 = $48 * .5;
    $50 = 1.0 - $49;
    $79 = 1.0 - $50 - $49;
    $49 = $48 * $48;
    $66 = $50 + ($79 + ($48 * ($48 * ($48 * ($48 * 2.480158728947673e-05 + -.001388888888887411) + .0416666666666666) + $49 * $49 * ($48 * ($48 * -1.1359647557788195e-11 + 2.087572321298175e-09) + -2.7557314351390663e-07)) + $5_1 * -0.0));
    break block;
   }
   $66 = $5_1 - $5_1;
   if ($6_1 >>> 0 >= 2146435072 >>> 0) {
    break block
   }
   $17_1 = global$0 - 48 | 0;
   global$0 = $17_1;
   block2 : {
    block3 : {
     block1 : {
      wasm2js_scratch_store_f64(+$5_1);
      i64toi32_i32$1 = wasm2js_scratch_load_i32(1 | 0) | 0;
      $53 = wasm2js_scratch_load_i32(0 | 0) | 0;
      $53$hi = i64toi32_i32$1;
      i64toi32_i32$0 = $53;
      i64toi32_i32$2 = 0;
      i64toi32_i32$3 = 32;
      i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
      if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
       i64toi32_i32$2 = 0;
       $112 = i64toi32_i32$1 >>> i64toi32_i32$4 | 0;
      } else {
       i64toi32_i32$2 = i64toi32_i32$1 >>> i64toi32_i32$4 | 0;
       $112 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$1 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$0 >>> i64toi32_i32$4 | 0) | 0;
      }
      $6_1 = $112;
      $11_1 = $6_1 & 2147483647 | 0;
      if ($11_1 >>> 0 <= 1074752122 >>> 0) {
       if (($6_1 & 1048575 | 0 | 0) == (598523 | 0)) {
        break block1
       }
       if ($11_1 >>> 0 <= 1073928572 >>> 0) {
        i64toi32_i32$2 = $53$hi;
        i64toi32_i32$1 = $53;
        i64toi32_i32$0 = 0;
        i64toi32_i32$3 = 0;
        if ((i64toi32_i32$2 | 0) > (i64toi32_i32$0 | 0)) {
         $113 = 1
        } else {
         if ((i64toi32_i32$2 | 0) >= (i64toi32_i32$0 | 0)) {
          if (i64toi32_i32$1 >>> 0 < i64toi32_i32$3 >>> 0) {
           $114 = 0
          } else {
           $114 = 1
          }
          $115 = $114;
         } else {
          $115 = 0
         }
         $113 = $115;
        }
        if ($113) {
         $5_1 = $5_1 + -1.5707963267341256;
         $48 = $5_1 + -6.077100506506192e-11;
         HEAPF64[$14_1 >> 3] = $48;
         HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1 - $48 + -6.077100506506192e-11;
         $6_1 = 1;
         break block2;
        }
        $5_1 = $5_1 + 1.5707963267341256;
        $48 = $5_1 + 6.077100506506192e-11;
        HEAPF64[$14_1 >> 3] = $48;
        HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1 - $48 + 6.077100506506192e-11;
        $6_1 = -1;
        break block2;
       }
       i64toi32_i32$1 = $53$hi;
       i64toi32_i32$3 = $53;
       i64toi32_i32$2 = 0;
       i64toi32_i32$0 = 0;
       if ((i64toi32_i32$1 | 0) > (i64toi32_i32$2 | 0)) {
        $116 = 1
       } else {
        if ((i64toi32_i32$1 | 0) >= (i64toi32_i32$2 | 0)) {
         if (i64toi32_i32$3 >>> 0 < i64toi32_i32$0 >>> 0) {
          $117 = 0
         } else {
          $117 = 1
         }
         $118 = $117;
        } else {
         $118 = 0
        }
        $116 = $118;
       }
       if ($116) {
        $5_1 = $5_1 + -3.1415926534682512;
        $48 = $5_1 + -1.2154201013012384e-10;
        HEAPF64[$14_1 >> 3] = $48;
        HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1 - $48 + -1.2154201013012384e-10;
        $6_1 = 2;
        break block2;
       }
       $5_1 = $5_1 + 3.1415926534682512;
       $48 = $5_1 + 1.2154201013012384e-10;
       HEAPF64[$14_1 >> 3] = $48;
       HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1 - $48 + 1.2154201013012384e-10;
       $6_1 = -2;
       break block2;
      }
      if ($11_1 >>> 0 <= 1075594811 >>> 0) {
       if ($11_1 >>> 0 <= 1075183036 >>> 0) {
        if (($11_1 | 0) == (1074977148 | 0)) {
         break block1
        }
        i64toi32_i32$3 = $53$hi;
        i64toi32_i32$0 = $53;
        i64toi32_i32$1 = 0;
        i64toi32_i32$2 = 0;
        if ((i64toi32_i32$3 | 0) > (i64toi32_i32$1 | 0)) {
         $119 = 1
        } else {
         if ((i64toi32_i32$3 | 0) >= (i64toi32_i32$1 | 0)) {
          if (i64toi32_i32$0 >>> 0 < i64toi32_i32$2 >>> 0) {
           $120 = 0
          } else {
           $120 = 1
          }
          $121 = $120;
         } else {
          $121 = 0
         }
         $119 = $121;
        }
        if ($119) {
         $5_1 = $5_1 + -4.712388980202377;
         $48 = $5_1 + -1.8231301519518578e-10;
         HEAPF64[$14_1 >> 3] = $48;
         HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1 - $48 + -1.8231301519518578e-10;
         $6_1 = 3;
         break block2;
        }
        $5_1 = $5_1 + 4.712388980202377;
        $48 = $5_1 + 1.8231301519518578e-10;
        HEAPF64[$14_1 >> 3] = $48;
        HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1 - $48 + 1.8231301519518578e-10;
        $6_1 = -3;
        break block2;
       }
       if (($11_1 | 0) == (1075388923 | 0)) {
        break block1
       }
       i64toi32_i32$0 = $53$hi;
       i64toi32_i32$2 = $53;
       i64toi32_i32$3 = 0;
       i64toi32_i32$1 = 0;
       if ((i64toi32_i32$0 | 0) > (i64toi32_i32$3 | 0)) {
        $122 = 1
       } else {
        if ((i64toi32_i32$0 | 0) >= (i64toi32_i32$3 | 0)) {
         if (i64toi32_i32$2 >>> 0 < i64toi32_i32$1 >>> 0) {
          $123 = 0
         } else {
          $123 = 1
         }
         $124 = $123;
        } else {
         $124 = 0
        }
        $122 = $124;
       }
       if ($122) {
        $5_1 = $5_1 + -6.2831853069365025;
        $48 = $5_1 + -2.430840202602477e-10;
        HEAPF64[$14_1 >> 3] = $48;
        HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1 - $48 + -2.430840202602477e-10;
        $6_1 = 4;
        break block2;
       }
       $5_1 = $5_1 + 6.2831853069365025;
       $48 = $5_1 + 2.430840202602477e-10;
       HEAPF64[$14_1 >> 3] = $48;
       HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1 - $48 + 2.430840202602477e-10;
       $6_1 = -4;
       break block2;
      }
      if ($11_1 >>> 0 > 1094263290 >>> 0) {
       break block3
      }
     }
     $49 = $5_1 * .6366197723675814 + 6755399441055744.0 + -6755399441055744.0;
     $5_1 = $5_1 + $49 * -1.5707963267341256;
     $51 = $49 * 6.077100506506192e-11;
     $50 = $5_1 - $51;
     HEAPF64[$14_1 >> 3] = $50;
     block4 : {
      $6_1 = $11_1 >>> 20 | 0;
      $255 = $6_1;
      wasm2js_scratch_store_f64(+$50);
      i64toi32_i32$2 = wasm2js_scratch_load_i32(1 | 0) | 0;
      i64toi32_i32$1 = wasm2js_scratch_load_i32(0 | 0) | 0;
      i64toi32_i32$0 = 0;
      i64toi32_i32$3 = 52;
      i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
      if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
       i64toi32_i32$0 = 0;
       $125 = i64toi32_i32$2 >>> i64toi32_i32$4 | 0;
      } else {
       i64toi32_i32$0 = i64toi32_i32$2 >>> i64toi32_i32$4 | 0;
       $125 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$2 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$1 >>> i64toi32_i32$4 | 0) | 0;
      }
      if (($255 - ($125 & 2047 | 0) | 0 | 0) < (17 | 0)) {
       break block4
      }
      $50 = $49 * 6.077100506303966e-11;
      $48 = $5_1 - $50;
      $51 = $49 * 2.0222662487959506e-21 - ($5_1 - $48 - $50);
      $50 = $48 - $51;
      HEAPF64[$14_1 >> 3] = $50;
      $281 = $6_1;
      wasm2js_scratch_store_f64(+$50);
      i64toi32_i32$0 = wasm2js_scratch_load_i32(1 | 0) | 0;
      i64toi32_i32$2 = wasm2js_scratch_load_i32(0 | 0) | 0;
      i64toi32_i32$1 = 0;
      i64toi32_i32$3 = 52;
      i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
      if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
       i64toi32_i32$1 = 0;
       $126 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
      } else {
       i64toi32_i32$1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
       $126 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
      }
      if (($281 - ($126 & 2047 | 0) | 0 | 0) < (50 | 0)) {
       $5_1 = $48;
       break block4;
      }
      $50 = $49 * 2.0222662487111665e-21;
      $5_1 = $48 - $50;
      $51 = $49 * 8.4784276603689e-32 - ($48 - $5_1 - $50);
      $50 = $5_1 - $51;
      HEAPF64[$14_1 >> 3] = $50;
     }
     if (Math_abs($49) < 2147483647.0) {
      $313 = ~~$49
     } else {
      $313 = -2147483648
     }
     $6_1 = $313;
     HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1 - $50 - $51;
     break block2;
    }
    if ($11_1 >>> 0 >= 2146435072 >>> 0) {
     $5_1 = $5_1 - $5_1;
     HEAPF64[$14_1 >> 3] = $5_1;
     HEAPF64[($14_1 + 8 | 0) >> 3] = $5_1;
     $6_1 = 0;
     break block2;
    }
    $330 = $17_1;
    i64toi32_i32$1 = $53$hi;
    i64toi32_i32$0 = $53;
    i64toi32_i32$2 = 1048575;
    i64toi32_i32$3 = -1;
    i64toi32_i32$2 = i64toi32_i32$1 & i64toi32_i32$2 | 0;
    i64toi32_i32$1 = i64toi32_i32$0 & i64toi32_i32$3 | 0;
    i64toi32_i32$0 = 1096810496;
    i64toi32_i32$3 = 0;
    i64toi32_i32$0 = i64toi32_i32$2 | i64toi32_i32$0 | 0;
    wasm2js_scratch_store_i32(0 | 0, i64toi32_i32$1 | i64toi32_i32$3 | 0 | 0);
    wasm2js_scratch_store_i32(1 | 0, i64toi32_i32$0 | 0);
    $5_1 = +wasm2js_scratch_load_f64();
    if (Math_abs($5_1) < 2147483647.0) {
     $340 = ~~$5_1
    } else {
     $340 = -2147483648
    }
    $48 = +($340 | 0);
    HEAPF64[($330 + 16 | 0) >> 3] = $48;
    $344 = $17_1;
    $5_1 = ($5_1 - $48) * 16777216.0;
    if (Math_abs($5_1) < 2147483647.0) {
     $354 = ~~$5_1
    } else {
     $354 = -2147483648
    }
    $48 = +($354 | 0);
    HEAPF64[($344 + 24 | 0) >> 3] = $48;
    HEAPF64[($17_1 + 32 | 0) >> 3] = ($5_1 - $48) * 16777216.0;
    $6_1 = $17_1 + 32 | 0;
    $8_1 = 3;
    label : while (1) {
     $8_1 = $8_1 - 1 | 0;
     $368 = +HEAPF64[$6_1 >> 3];
     $6_1 = $6_1 - 8 | 0;
     if ($368 == 0.0) {
      continue label
     }
     break label;
    };
    block39 : {
     $21_1 = $17_1 + 16 | 0;
     $10_1 = global$0 - 560 | 0;
     global$0 = $10_1;
     $6_1 = ($11_1 >>> 20 | 0) - 1046 | 0;
     $11_1 = ($6_1 - 3 | 0 | 0) / (24 | 0) | 0;
     $16_1 = ($11_1 | 0) > (0 | 0) ? $11_1 : 0;
     $15_1 = Math_imul($16_1, -24) + $6_1 | 0;
     block5 : {
      $19_1 = HEAP32[66612 >> 2] | 0;
      $18_1 = $8_1 + 1 | 0;
      $23_1 = $18_1 - 1 | 0;
      $6_1 = $19_1 + $23_1 | 0;
      if (($6_1 | 0) < (0 | 0)) {
       break block5
      }
      if ($6_1) {
       $6_1 = $18_1 + $19_1 | 0;
       scratch = $6_1 & 1 | 0;
       $9_1 = (($16_1 << 2 | 0) - ($18_1 << 2 | 0) | 0) + 66628 | 0;
       $11_1 = $16_1 - $18_1 | 0;
       $13_1 = $6_1 & -2 | 0;
       $12_1 = ($18_1 - $16_1 | 0) - 2 | 0;
       $6_1 = $10_1 + 320 | 0;
       label1 : while (1) {
        $427 = $6_1 + 8 | 0;
        block7 : {
         block6 : {
          if ((($7_1 + $11_1 | 0) + 1 | 0 | 0) >= (0 | 0)) {
           HEAPF64[$6_1 >> 3] = +(HEAP32[$9_1 >> 2] | 0 | 0);
           break block6;
          }
          i64toi32_i32$1 = $6_1;
          i64toi32_i32$0 = 0;
          HEAP32[$6_1 >> 2] = 0;
          HEAP32[($6_1 + 4 | 0) >> 2] = i64toi32_i32$0;
          $441 = 0.0;
          if (($7_1 | 0) != ($12_1 | 0)) {
           break block7
          }
         }
         $441 = +(HEAP32[($9_1 + 4 | 0) >> 2] | 0 | 0);
        }
        HEAPF64[$427 >> 3] = $441;
        $6_1 = $6_1 + 16 | 0;
        $9_1 = $9_1 + 8 | 0;
        $7_1 = $7_1 + 2 | 0;
        if (($13_1 | 0) != ($7_1 | 0)) {
         continue label1
        }
        break label1;
       };
       if (!scratch) {
        break block5
       }
       $470 = ($7_1 + $11_1 | 0) + 1 | 0;
      } else {
       $470 = $16_1 - $23_1 | 0
      }
      $6_1 = $470;
      if (($6_1 | 0) < (0 | 0)) {
       $478 = 0.0
      } else {
       $478 = +(HEAP32[(($6_1 << 2 | 0) + 66624 | 0) >> 2] | 0 | 0)
      }
      $5_1 = $478;
      HEAPF64[(($10_1 + 320 | 0) + ($7_1 << 3 | 0) | 0) >> 3] = $5_1;
     }
     $12_1 = $15_1 - 24 | 0;
     $6_1 = 0;
     $24_1 = ($19_1 | 0) > (0 | 0) ? $19_1 : 0;
     $11_1 = $18_1 & 2147483646 | 0;
     $26_1 = $18_1 & 1 | 0;
     $13_1 = (($18_1 << 3 | 0) + $10_1 | 0) + 304 | 0;
     label3 : while (1) {
      $8_1 = $6_1;
      block8 : {
       if (($18_1 | 0) <= (0 | 0)) {
        $5_1 = 0.0;
        break block8;
       }
       block9 : {
        if (!$23_1) {
         $6_1 = 0;
         $5_1 = 0.0;
         break block9;
        }
        $5_1 = 0.0;
        $6_1 = $21_1;
        $7_1 = $13_1;
        $9_1 = $11_1;
        label2 : while (1) {
         $5_1 = +HEAPF64[($6_1 + 8 | 0) >> 3] * +HEAPF64[$7_1 >> 3] + (+HEAPF64[$6_1 >> 3] * +HEAPF64[($7_1 + 8 | 0) >> 3] + $5_1);
         $6_1 = $6_1 + 16 | 0;
         $7_1 = $7_1 - 16 | 0;
         $9_1 = $9_1 - 2 | 0;
         if ($9_1) {
          continue label2
         }
         break label2;
        };
        $6_1 = $11_1;
        if (!$26_1) {
         break block8
        }
       }
       $5_1 = +HEAPF64[($21_1 + ($6_1 << 3 | 0) | 0) >> 3] * +HEAPF64[(($10_1 + 320 | 0) + ((($8_1 + $23_1 | 0) - $6_1 | 0) << 3 | 0) | 0) >> 3] + $5_1;
      }
      HEAPF64[($10_1 + ($8_1 << 3 | 0) | 0) >> 3] = $5_1;
      $13_1 = $13_1 + 8 | 0;
      $6_1 = $8_1 + 1 | 0;
      if (($8_1 | 0) != ($24_1 | 0)) {
       continue label3
      }
      break label3;
     };
     $27_1 = ($15_1 | 0) > (2070 | 0);
     $28_1 = $27_1 ? ($12_1 >>> 0 >= 3069 >>> 0 ? 3069 : $12_1) - 2046 | 0 : $15_1 - 1047 | 0;
     $29_1 = ($15_1 | 0) < (-1967 | 0);
     $30_1 = $29_1 ? ($12_1 >>> 0 <= -2960 >>> 0 ? -2960 : $12_1) + 1938 | 0 : $15_1 + 945 | 0;
     $33_1 = 47 - $15_1 | 0;
     $31_1 = 48 - $15_1 | 0;
     $34_1 = $10_1 + 476 | 0;
     $24_1 = $34_1 + ($19_1 << 2 | 0) | 0;
     $35_1 = ($16_1 << 2 | 0) + 66624 | 0;
     $36_1 = $10_1 + 312 | 0;
     $37_1 = $10_1 + 464 | 0;
     $38_1 = $10_1 + 480 | 0 | 4 | 0;
     $39_1 = $10_1 - 16 | 0;
     $40_1 = ($15_1 | 0) < (1048 | 0);
     $32_1 = ($15_1 | 0) < (25 | 0);
     $41_1 = $12_1 - 1 | 0;
     $42_1 = ($15_1 | 0) < (-998 | 0);
     $43 = ($15_1 | 0) > (1047 | 0);
     $48 = $43 ? ($27_1 ? Infinity : 8988465674311579538646525.0e283) : $42_1 ? ($29_1 ? 0.0 : 2.004168360008973e-292) : 1.0;
     $44 = ($15_1 | 0) > (-999 | 0);
     $8_1 = $19_1;
     label20 : while (1) {
      $6_1 = $8_1 << 3 | 0;
      $5_1 = +HEAPF64[($10_1 + $6_1 | 0) >> 3];
      block10 : {
       if (($8_1 | 0) <= (0 | 0)) {
        break block10
       }
       $20_1 = 1;
       $9_1 = 0;
       if (($8_1 | 0) != (1 | 0)) {
        scratch_50 = $8_1 & 1 | 0;
        $20_1 = $8_1 & -2147483647 | 0;
        $16_1 = $8_1 & 2147483646 | 0;
        $6_1 = $6_1 + $39_1 | 0;
        $7_1 = $10_1 + 480 | 0;
        label4 : while (1) {
         $650 = $7_1;
         $49 = $5_1 * 5.9604644775390625e-08;
         if (Math_abs($49) < 2147483647.0) {
          $658 = ~~$49
         } else {
          $658 = -2147483648
         }
         $49 = +($658 | 0);
         $5_1 = $49 * -16777216.0 + $5_1;
         if (Math_abs($5_1) < 2147483647.0) {
          $670 = ~~$5_1
         } else {
          $670 = -2147483648
         }
         HEAP32[$650 >> 2] = $670;
         $673 = $7_1 + 4 | 0;
         $5_1 = +HEAPF64[($6_1 + 8 | 0) >> 3] + $49;
         $49 = $5_1 * 5.9604644775390625e-08;
         if (Math_abs($49) < 2147483647.0) {
          $686 = ~~$49
         } else {
          $686 = -2147483648
         }
         $49 = +($686 | 0);
         $5_1 = $49 * -16777216.0 + $5_1;
         if (Math_abs($5_1) < 2147483647.0) {
          $698 = ~~$5_1
         } else {
          $698 = -2147483648
         }
         HEAP32[$673 >> 2] = $698;
         $5_1 = +HEAPF64[$6_1 >> 3] + $49;
         $7_1 = $7_1 + 8 | 0;
         $6_1 = $6_1 - 16 | 0;
         $9_1 = $9_1 + 2 | 0;
         if (($16_1 | 0) != ($9_1 | 0)) {
          continue label4
         }
         break label4;
        };
        if (!scratch_50) {
         break block10
        }
       }
       $721 = ($10_1 + 480 | 0) + ($9_1 << 2 | 0) | 0;
       $49 = $5_1 * 5.9604644775390625e-08;
       if (Math_abs($49) < 2147483647.0) {
        $729 = ~~$49
       } else {
        $729 = -2147483648
       }
       $49 = +($729 | 0);
       $5_1 = $49 * -16777216.0 + $5_1;
       if (Math_abs($5_1) < 2147483647.0) {
        $741 = ~~$5_1
       } else {
        $741 = -2147483648
       }
       HEAP32[$721 >> 2] = $741;
       $5_1 = +HEAPF64[(($10_1 + ($20_1 << 3 | 0) | 0) - 8 | 0) >> 3] + $49;
      }
      block11 : {
       if (!$40_1) {
        $5_1 = $5_1 * 8988465674311579538646525.0e283;
        $5_1 = $27_1 ? $5_1 * 8988465674311579538646525.0e283 : $5_1;
        $761 = $28_1;
        break block11;
       }
       $761 = $12_1;
       if ($44) {
        break block11
       }
       $5_1 = $5_1 * 2.004168360008973e-292;
       $5_1 = $29_1 ? $5_1 * 2.004168360008973e-292 : $5_1;
       $761 = $30_1;
      }
      $6_1 = $761;
      $774 = $5_1;
      i64toi32_i32$0 = 0;
      i64toi32_i32$2 = $6_1 + 1023 | 0;
      i64toi32_i32$1 = 0;
      i64toi32_i32$3 = 52;
      i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
      if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
       i64toi32_i32$1 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
       $127 = 0;
      } else {
       i64toi32_i32$1 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$2 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$0 << i64toi32_i32$4 | 0) | 0;
       $127 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
      }
      wasm2js_scratch_store_i32(0 | 0, $127 | 0);
      wasm2js_scratch_store_i32(1 | 0, i64toi32_i32$1 | 0);
      $5_1 = $774 * +wasm2js_scratch_load_f64();
      $5_1 = Math_floor($5_1 * .125) * -8.0 + $5_1;
      $787 = $5_1;
      if (Math_abs($5_1) < 2147483647.0) {
       $793 = ~~$5_1
      } else {
       $793 = -2147483648
      }
      $22_1 = $793;
      $5_1 = $787 - +($22_1 | 0);
      block14 : {
       block15 : {
        block13 : {
         block12 : {
          if (!$32_1) {
           $6_1 = (($8_1 << 2 | 0) + $10_1 | 0) + 476 | 0;
           $805 = $6_1;
           $6_1 = HEAP32[$6_1 >> 2] | 0;
           $808 = $6_1;
           $6_1 = $6_1 >> $31_1 | 0;
           $7_1 = $808 - ($6_1 << $31_1 | 0) | 0;
           HEAP32[$805 >> 2] = $7_1;
           $22_1 = $6_1 + $22_1 | 0;
           $823 = $7_1 >> $33_1 | 0;
           break block12;
          }
          if ($12_1) {
           break block13
          }
          $823 = (HEAP32[((($8_1 << 2 | 0) + $10_1 | 0) + 476 | 0) >> 2] | 0) >> 23 | 0;
         }
         $16_1 = $823;
         if (($16_1 | 0) <= (0 | 0)) {
          break block14
         }
         break block15;
        }
        $16_1 = 2;
        if ($5_1 >= .5) {
         break block15
        }
        $16_1 = 0;
        break block14;
       }
       $9_1 = 1;
       block16 : {
        if (($8_1 | 0) <= (0 | 0)) {
         break block16
        }
        block21 : {
         block17 : {
          if (($8_1 | 0) == (1 | 0)) {
           $7_1 = $10_1 + 480 | 0;
           $6_1 = HEAP32[($10_1 + 480 | 0) >> 2] | 0;
           break block17;
          }
          scratch_51 = $8_1 & 1 | 0;
          $46 = $8_1 & 2147483646 | 0;
          $7_1 = 0;
          $6_1 = $38_1;
          $25_1 = 0;
          label5 : while (1) {
           $47 = $6_1 - 4 | 0;
           $9_1 = HEAP32[$47 >> 2] | 0;
           $20_1 = 16777215;
           $13_1 = 16777215;
           block20 : {
            block19 : {
             block18 : {
              if (!$25_1) {
               $13_1 = 16777216;
               if (!$9_1) {
                break block18
               }
              }
              HEAP32[$47 >> 2] = $13_1 - $9_1 | 0;
              $9_1 = (($7_1 << 2 | 0) + $10_1 | 0) + 484 | 0;
              $13_1 = HEAP32[$6_1 >> 2] | 0;
              break block19;
             }
             $20_1 = 16777216;
             $9_1 = $6_1;
             $13_1 = HEAP32[$6_1 >> 2] | 0;
             if ($13_1) {
              break block19
             }
             $25_1 = 0;
             $873 = 1;
             break block20;
            }
            HEAP32[$9_1 >> 2] = $20_1 - $13_1 | 0;
            $25_1 = 1;
            $873 = 0;
           }
           $9_1 = $873;
           $6_1 = $6_1 + 8 | 0;
           $7_1 = $7_1 + 2 | 0;
           if (($46 | 0) != ($7_1 | 0)) {
            continue label5
           }
           break label5;
          };
          if (!scratch_51) {
           break block16
          }
          $7_1 = ($10_1 + 480 | 0) + ($7_1 << 2 | 0) | 0;
          $6_1 = HEAP32[$7_1 >> 2] | 0;
          if ($9_1) {
           break block17
          }
          $898 = 16777215;
          break block21;
         }
         $9_1 = 1;
         if (!$6_1) {
          break block16
         }
         $898 = 16777216;
        }
        $9_1 = $898;
        HEAP32[$7_1 >> 2] = $9_1 - $6_1 | 0;
        $9_1 = 0;
       }
       block22 : {
        if ($32_1) {
         break block22
        }
        $6_1 = 8388607;
        block23 : {
         switch ($41_1 | 0) {
         case 1:
          $6_1 = 4194303;
          break;
         case 0:
          break block23;
         default:
          break block22;
         };
        }
        $7_1 = (($8_1 << 2 | 0) + $10_1 | 0) + 476 | 0;
        HEAP32[$7_1 >> 2] = (HEAP32[$7_1 >> 2] | 0) & $6_1 | 0;
       }
       $22_1 = $22_1 + 1 | 0;
       if (($16_1 | 0) != (2 | 0)) {
        break block14
       }
       $5_1 = 1.0 - $5_1;
       $16_1 = 2;
       if ($9_1) {
        break block14
       }
       $925 = $5_1;
       $926 = $48;
       i64toi32_i32$1 = 0;
       i64toi32_i32$0 = ($43 ? $28_1 : $42_1 ? $30_1 : $12_1) + 1023 | 0;
       i64toi32_i32$2 = 0;
       i64toi32_i32$3 = 52;
       i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
       if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
        i64toi32_i32$2 = i64toi32_i32$0 << i64toi32_i32$4 | 0;
        $128 = 0;
       } else {
        i64toi32_i32$2 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$0 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$1 << i64toi32_i32$4 | 0) | 0;
        $128 = i64toi32_i32$0 << i64toi32_i32$4 | 0;
       }
       wasm2js_scratch_store_i32(0 | 0, $128 | 0);
       wasm2js_scratch_store_i32(1 | 0, i64toi32_i32$2 | 0);
       $5_1 = $925 - $926 * +wasm2js_scratch_load_f64();
      }
      block25 : {
       block27 : {
        if ($5_1 == 0.0) {
         if (($8_1 | 0) <= ($19_1 | 0)) {
          break block25
         }
         $13_1 = $8_1 - $19_1 | 0;
         $9_1 = $13_1 & 3 | 0;
         $7_1 = 0;
         block26 : {
          $950 = $34_1;
          if (($19_1 - $8_1 | 0) >>> 0 <= -4 >>> 0) {
           $6_1 = $37_1 + ($8_1 << 2 | 0) | 0;
           $20_1 = $13_1 & -4 | 0;
           $13_1 = $20_1;
           label6 : while (1) {
            $7_1 = HEAP32[$6_1 >> 2] | 0 | (HEAP32[($6_1 + 4 | 0) >> 2] | 0 | (HEAP32[($6_1 + 8 | 0) >> 2] | 0 | (HEAP32[($6_1 + 12 | 0) >> 2] | 0 | $7_1 | 0) | 0) | 0) | 0;
            $6_1 = $6_1 - 16 | 0;
            $13_1 = $13_1 - 4 | 0;
            if ($13_1) {
             continue label6
            }
            break label6;
           };
           if (!$9_1) {
            break block26
           }
           $991 = $8_1 - $20_1 | 0;
          } else {
           $991 = $8_1
          }
          $6_1 = $950 + ($991 << 2 | 0) | 0;
          label7 : while (1) {
           $7_1 = HEAP32[$6_1 >> 2] | 0 | $7_1 | 0;
           $6_1 = $6_1 - 4 | 0;
           $9_1 = $9_1 - 1 | 0;
           if ($9_1) {
            continue label7
           }
           break label7;
          };
         }
         if (!$7_1) {
          break block25
         }
         $6_1 = (($8_1 << 2 | 0) + $10_1 | 0) + 476 | 0;
         label8 : while (1) {
          $8_1 = $8_1 - 1 | 0;
          $12_1 = $12_1 - 24 | 0;
          $7_1 = HEAP32[$6_1 >> 2] | 0;
          $6_1 = $6_1 - 4 | 0;
          if (!$7_1) {
           continue label8
          }
          break label8;
         };
         break block27;
        }
        $6_1 = 24 - $15_1 | 0;
        block28 : {
         if (($15_1 | 0) <= (-1e3 | 0)) {
          $5_1 = $5_1 * 8988465674311579538646525.0e283;
          if ($6_1 >>> 0 < 2047 >>> 0) {
           $6_1 = -999 - $15_1 | 0;
           break block28;
          }
          $5_1 = $5_1 * 8988465674311579538646525.0e283;
          $6_1 = ($6_1 >>> 0 >= 3069 >>> 0 ? 3069 : $6_1) - 2046 | 0;
          break block28;
         }
         if (($15_1 | 0) < (1047 | 0)) {
          break block28
         }
         $5_1 = $5_1 * 2.004168360008973e-292;
         if ($6_1 >>> 0 > -1992 >>> 0) {
          $6_1 = 993 - $15_1 | 0;
          break block28;
         }
         $5_1 = $5_1 * 2.004168360008973e-292;
         $6_1 = ($6_1 >>> 0 <= -2960 >>> 0 ? -2960 : $6_1) + 1938 | 0;
        }
        block29 : {
         $1053 = $5_1;
         i64toi32_i32$2 = 0;
         i64toi32_i32$1 = $6_1 + 1023 | 0;
         i64toi32_i32$0 = 0;
         i64toi32_i32$3 = 52;
         i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
         if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
          i64toi32_i32$0 = i64toi32_i32$1 << i64toi32_i32$4 | 0;
          $129 = 0;
         } else {
          i64toi32_i32$0 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$1 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$2 << i64toi32_i32$4 | 0) | 0;
          $129 = i64toi32_i32$1 << i64toi32_i32$4 | 0;
         }
         wasm2js_scratch_store_i32(0 | 0, $129 | 0);
         wasm2js_scratch_store_i32(1 | 0, i64toi32_i32$0 | 0);
         $5_1 = $1053 * +wasm2js_scratch_load_f64();
         if ($5_1 >= 16777216.0) {
          $1066 = ($10_1 + 480 | 0) + ($8_1 << 2 | 0) | 0;
          $48 = $5_1 * 5.9604644775390625e-08;
          if (Math_abs($48) < 2147483647.0) {
           $1074 = ~~$48
          } else {
           $1074 = -2147483648
          }
          $7_1 = $1074;
          $5_1 = +($7_1 | 0) * -16777216.0 + $5_1;
          if (Math_abs($5_1) < 2147483647.0) {
           $1086 = ~~$5_1
          } else {
           $1086 = -2147483648
          }
          HEAP32[$1066 >> 2] = $1086;
          $8_1 = $8_1 + 1 | 0;
          $12_1 = $15_1;
          break block29;
         }
         if (Math_abs($5_1) < 2147483647.0) {
          $1096 = ~~$5_1
         } else {
          $1096 = -2147483648
         }
         $7_1 = $1096;
        }
        HEAP32[(($10_1 + 480 | 0) + ($8_1 << 2 | 0) | 0) >> 2] = $7_1;
       }
       if (($8_1 | 0) >= (0 | 0)) {
        block30 : {
         if (($12_1 | 0) >= (1024 | 0)) {
          if ($12_1 >>> 0 < 2047 >>> 0) {
           $12_1 = $12_1 - 1023 | 0;
           $1112 = 8988465674311579538646525.0e283;
           break block30;
          }
          $12_1 = ($12_1 >>> 0 >= 3069 >>> 0 ? 3069 : $12_1) - 2046 | 0;
          $1112 = Infinity;
          break block30;
         }
         $1112 = 1.0;
         if (($12_1 | 0) > (-1023 | 0)) {
          break block30
         }
         if ($12_1 >>> 0 > -1992 >>> 0) {
          $12_1 = $12_1 + 969 | 0;
          $1112 = 2.004168360008973e-292;
          break block30;
         }
         $12_1 = ($12_1 >>> 0 <= -2960 >>> 0 ? -2960 : $12_1) + 1938 | 0;
         $1112 = 0.0;
        }
        $1130 = $1112;
        i64toi32_i32$0 = 0;
        i64toi32_i32$2 = $12_1 + 1023 | 0;
        i64toi32_i32$1 = 0;
        i64toi32_i32$3 = 52;
        i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
        if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
         i64toi32_i32$1 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
         $130 = 0;
        } else {
         i64toi32_i32$1 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$2 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$0 << i64toi32_i32$4 | 0) | 0;
         $130 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
        }
        wasm2js_scratch_store_i32(0 | 0, $130 | 0);
        wasm2js_scratch_store_i32(1 | 0, i64toi32_i32$1 | 0);
        $5_1 = $1130 * +wasm2js_scratch_load_f64();
        $1137 = $10_1;
        block32 : {
         block31 : {
          if ($8_1 & 1 | 0) {
           $1157 = $8_1
          } else {
           HEAPF64[($10_1 + ($8_1 << 3 | 0) | 0) >> 3] = $5_1 * +($7_1 | 0);
           if (!$8_1) {
            break block31
           }
           $5_1 = $5_1 * 5.9604644775390625e-08;
           $1157 = $8_1 - 1 | 0;
          }
          $11_1 = $1157;
          $9_1 = $11_1 + 1 | 0;
          $6_1 = (($11_1 << 2 | 0) + $10_1 | 0) + 476 | 0;
          $7_1 = (($11_1 << 3 | 0) + $10_1 | 0) - 8 | 0;
          label9 : while (1) {
           $48 = $5_1 * 5.9604644775390625e-08;
           HEAPF64[$7_1 >> 3] = $48 * +(HEAP32[$6_1 >> 2] | 0 | 0);
           HEAPF64[($7_1 + 8 | 0) >> 3] = $5_1 * +(HEAP32[($6_1 + 4 | 0) >> 2] | 0 | 0);
           $6_1 = $6_1 - 8 | 0;
           $7_1 = $7_1 - 16 | 0;
           $5_1 = $48 * 5.9604644775390625e-08;
           $9_1 = $9_1 - 2 | 0;
           if ($9_1) {
            continue label9
           }
           break label9;
          };
          $1197 = $8_1;
          break block32;
         }
         $1197 = 0;
        }
        $6_1 = $1197;
        $13_1 = $1137 + ($6_1 << 3 | 0) | 0;
        label12 : while (1) {
         block33 : {
          $11_1 = $6_1;
          $21_1 = $8_1 - $6_1 | 0;
          $6_1 = ($19_1 | 0) < ($21_1 | 0) ? $19_1 : $21_1;
          if (($6_1 | 0) < (0 | 0)) {
           $5_1 = 0.0;
           break block33;
          }
          $7_1 = $6_1 + 1 | 0;
          $9_1 = $7_1 & 3 | 0;
          block34 : {
           if ($6_1 >>> 0 < 3 >>> 0) {
            $12_1 = 0;
            $5_1 = 0.0;
            break block34;
           }
           $5_1 = 0.0;
           $6_1 = 0;
           $12_1 = $7_1 & -4 | 0;
           $15_1 = $12_1;
           label10 : while (1) {
            $7_1 = $6_1 + $13_1 | 0;
            $5_1 = +HEAPF64[($6_1 + 69416 | 0) >> 3] * +HEAPF64[($7_1 + 24 | 0) >> 3] + (+HEAPF64[($6_1 + 69408 | 0) >> 3] * +HEAPF64[($7_1 + 16 | 0) >> 3] + (+HEAPF64[($6_1 + 69400 | 0) >> 3] * +HEAPF64[($7_1 + 8 | 0) >> 3] + (+HEAPF64[($6_1 + 69392 | 0) >> 3] * +HEAPF64[$7_1 >> 3] + $5_1)));
            $6_1 = $6_1 + 32 | 0;
            $15_1 = $15_1 - 4 | 0;
            if ($15_1) {
             continue label10
            }
            break label10;
           };
           if (!$9_1) {
            break block33
           }
          }
          $6_1 = $12_1 << 3 | 0;
          label11 : while (1) {
           $5_1 = +HEAPF64[($6_1 + 69392 | 0) >> 3] * +HEAPF64[($6_1 + $13_1 | 0) >> 3] + $5_1;
           $6_1 = $6_1 + 8 | 0;
           $9_1 = $9_1 - 1 | 0;
           if ($9_1) {
            continue label11
           }
           break label11;
          };
         }
         HEAPF64[(($10_1 + 160 | 0) + ($21_1 << 3 | 0) | 0) >> 3] = $5_1;
         $13_1 = $13_1 - 8 | 0;
         $6_1 = $11_1 - 1 | 0;
         if (($11_1 | 0) > (0 | 0)) {
          continue label12
         }
         break label12;
        };
       }
       block35 : {
        if (($8_1 | 0) < (0 | 0)) {
         $5_1 = 0.0;
         break block35;
        }
        block36 : {
         $11_1 = ($8_1 + 1 | 0) & 3 | 0;
         if (!$11_1) {
          $5_1 = 0.0;
          $1302 = $8_1;
          break block36;
         }
         $6_1 = ($10_1 + 160 | 0) + ($8_1 << 3 | 0) | 0;
         $5_1 = 0.0;
         $7_1 = $11_1;
         label13 : while (1) {
          $5_1 = $5_1 + +HEAPF64[$6_1 >> 3];
          $6_1 = $6_1 - 8 | 0;
          $7_1 = $7_1 - 1 | 0;
          if ($7_1) {
           continue label13
          }
          break label13;
         };
         $1302 = $8_1 - $11_1 | 0;
        }
        $6_1 = $1302;
        if ($8_1 >>> 0 < 3 >>> 0) {
         break block35
        }
        $7_1 = $6_1 - 3 | 0;
        if (!($7_1 & 4 | 0)) {
         $11_1 = ($10_1 + 160 | 0) + ($6_1 << 3 | 0) | 0;
         $5_1 = $5_1 + +HEAPF64[$11_1 >> 3] + +HEAPF64[($11_1 - 8 | 0) >> 3] + +HEAPF64[($11_1 - 16 | 0) >> 3] + +HEAPF64[($11_1 - 24 | 0) >> 3];
         $6_1 = $6_1 - 4 | 0;
        }
        if ($7_1 >>> 0 < 4 >>> 0) {
         break block35
        }
        $7_1 = $6_1 + 1 | 0;
        $6_1 = (($6_1 << 3 | 0) + $10_1 | 0) + 104 | 0;
        label14 : while (1) {
         $5_1 = $5_1 + +HEAPF64[($6_1 + 56 | 0) >> 3] + +HEAPF64[($6_1 + 48 | 0) >> 3] + +HEAPF64[($6_1 + 40 | 0) >> 3] + +HEAPF64[($6_1 + 32 | 0) >> 3] + +HEAPF64[($6_1 + 24 | 0) >> 3] + +HEAPF64[($6_1 + 16 | 0) >> 3] + +HEAPF64[($6_1 + 8 | 0) >> 3] + +HEAPF64[$6_1 >> 3];
         $6_1 = $6_1 + -64 | 0;
         $7_1 = $7_1 - 8 | 0;
         if ($7_1) {
          continue label14
         }
         break label14;
        };
       }
       HEAPF64[$17_1 >> 3] = $16_1 ? -$5_1 : $5_1;
       $5_1 = +HEAPF64[($10_1 + 160 | 0) >> 3] - $5_1;
       block37 : {
        if (($8_1 | 0) <= (0 | 0)) {
         break block37
        }
        $7_1 = $8_1 & 3 | 0;
        $6_1 = $10_1 + 160 | 0;
        $1414 = $6_1;
        if (($8_1 | 0) >= (4 | 0)) {
         $13_1 = 1;
         block38 : {
          $11_1 = $8_1 - 4 | 0;
          $9_1 = $11_1 >>> 2 | 0;
          if ($9_1) {
           $9_1 = ($9_1 + 1 | 0) & 2147483646 | 0;
           $13_1 = $9_1 << 2 | 0 | 1 | 0;
           label15 : while (1) {
            $1456 = $5_1 + +HEAPF64[($6_1 + 8 | 0) >> 3] + +HEAPF64[($6_1 + 16 | 0) >> 3] + +HEAPF64[($6_1 + 24 | 0) >> 3] + +HEAPF64[($6_1 + 32 | 0) >> 3] + +HEAPF64[($6_1 + 40 | 0) >> 3] + +HEAPF64[($6_1 + 48 | 0) >> 3] + +HEAPF64[($6_1 + 56 | 0) >> 3];
            $6_1 = $6_1 - -64 | 0;
            $5_1 = $1456 + +HEAPF64[$6_1 >> 3];
            $9_1 = $9_1 - 2 | 0;
            if ($9_1) {
             continue label15
            }
            break label15;
           };
           if ($11_1 & 4 | 0) {
            break block38
           }
          }
          $6_1 = ($10_1 + 160 | 0) + ($13_1 << 3 | 0) | 0;
          $5_1 = $5_1 + +HEAPF64[$6_1 >> 3] + +HEAPF64[($6_1 + 8 | 0) >> 3] + +HEAPF64[($6_1 + 16 | 0) >> 3] + +HEAPF64[($6_1 + 24 | 0) >> 3];
         }
         if (!$7_1) {
          break block37
         }
         $1492 = $8_1 & 2147483644 | 0 | 1 | 0;
        } else {
         $1492 = 1
        }
        $6_1 = $1414 + ($1492 << 3 | 0) | 0;
        label16 : while (1) {
         $5_1 = $5_1 + +HEAPF64[$6_1 >> 3];
         $6_1 = $6_1 + 8 | 0;
         $7_1 = $7_1 - 1 | 0;
         if ($7_1) {
          continue label16
         }
         break label16;
        };
       }
       HEAPF64[($17_1 + 8 | 0) >> 3] = $16_1 ? -$5_1 : $5_1;
       global$0 = $10_1 + 560 | 0;
       $1515 = $22_1 & 7 | 0;
       break block39;
      }
      $7_1 = 0;
      $6_1 = $24_1;
      label17 : while (1) {
       $7_1 = $7_1 + 1 | 0;
       scratch_52 = HEAP32[$6_1 >> 2] | 0;
       $6_1 = $6_1 - 4 | 0;
       if (!scratch_52) {
        continue label17
       }
       break label17;
      };
      $16_1 = $7_1 + $8_1 | 0;
      $13_1 = $36_1 + (($8_1 + $18_1 | 0) << 3 | 0) | 0;
      label19 : while (1) {
       $20_1 = $8_1 + $18_1 | 0;
       $8_1 = $8_1 + 1 | 0;
       HEAPF64[(($10_1 + 320 | 0) + ($20_1 << 3 | 0) | 0) >> 3] = +(HEAP32[($35_1 + ($8_1 << 2 | 0) | 0) >> 2] | 0 | 0);
       block40 : {
        if (($18_1 | 0) <= (0 | 0)) {
         $5_1 = 0.0;
         break block40;
        }
        block41 : {
         if (!$23_1) {
          $6_1 = 0;
          $5_1 = 0.0;
          break block41;
         }
         $5_1 = 0.0;
         $6_1 = $21_1;
         $7_1 = $13_1;
         $9_1 = $11_1;
         label18 : while (1) {
          $5_1 = +HEAPF64[($6_1 + 8 | 0) >> 3] * +HEAPF64[$7_1 >> 3] + (+HEAPF64[$6_1 >> 3] * +HEAPF64[($7_1 + 8 | 0) >> 3] + $5_1);
          $6_1 = $6_1 + 16 | 0;
          $7_1 = $7_1 - 16 | 0;
          $9_1 = $9_1 - 2 | 0;
          if ($9_1) {
           continue label18
          }
          break label18;
         };
         $6_1 = $11_1;
         if (!$26_1) {
          break block40
         }
        }
        $5_1 = +HEAPF64[($21_1 + ($6_1 << 3 | 0) | 0) >> 3] * +HEAPF64[(($10_1 + 320 | 0) + (($20_1 - $6_1 | 0) << 3 | 0) | 0) >> 3] + $5_1;
       }
       HEAPF64[($10_1 + ($8_1 << 3 | 0) | 0) >> 3] = $5_1;
       $13_1 = $13_1 + 8 | 0;
       if (($8_1 | 0) < ($16_1 | 0)) {
        continue label19
       }
       break label19;
      };
      $8_1 = $16_1;
      continue label20;
     };
    }
    $6_1 = $1515;
    $5_1 = +HEAPF64[$17_1 >> 3];
    i64toi32_i32$1 = $53$hi;
    i64toi32_i32$0 = $53;
    i64toi32_i32$2 = 0;
    i64toi32_i32$3 = 0;
    if ((i64toi32_i32$1 | 0) < (i64toi32_i32$2 | 0)) {
     $131 = 1
    } else {
     if ((i64toi32_i32$1 | 0) <= (i64toi32_i32$2 | 0)) {
      if (i64toi32_i32$0 >>> 0 >= i64toi32_i32$3 >>> 0) {
       $132 = 0
      } else {
       $132 = 1
      }
      $133 = $132;
     } else {
      $133 = 0
     }
     $131 = $133;
    }
    if ($131) {
     HEAPF64[$14_1 >> 3] = -$5_1;
     HEAPF64[($14_1 + 8 | 0) >> 3] = -+HEAPF64[($17_1 + 8 | 0) >> 3];
     $6_1 = 0 - $6_1 | 0;
     break block2;
    }
    HEAPF64[$14_1 >> 3] = $5_1;
    HEAPF64[($14_1 + 8 | 0) >> 3] = +HEAPF64[($17_1 + 8 | 0) >> 3];
   }
   global$0 = $17_1 + 48 | 0;
   $48 = +HEAPF64[$14_1 >> 3];
   $5_1 = $48 * $48;
   $49 = $5_1 * $5_1;
   $50 = +HEAPF64[($14_1 + 8 | 0) >> 3];
   block44 : {
    switch (($6_1 & 3 | 0) - 1 | 0 | 0) {
    default:
     $51 = $5_1 * .5;
     $52 = 1.0 - $51;
     $66 = $52 + (1.0 - $52 - $51 + ($5_1 * ($5_1 * ($5_1 * ($5_1 * 2.480158728947673e-05 + -.001388888888887411) + .0416666666666666) + $49 * $49 * ($5_1 * ($5_1 * -1.1359647557788195e-11 + 2.087572321298175e-09) + -2.7557314351390663e-07)) - $48 * $50));
     break block;
    case 0:
     $1681 = $48;
     $48 = $48 * $5_1;
     $66 = -($1681 - ($5_1 * ($50 * .5 - $48 * ($5_1 * $49 * ($5_1 * 1.58969099521155e-10 + -2.5050760253406863e-08) + ($5_1 * ($5_1 * 2.7557313707070068e-06 + -1.984126982985795e-04) + .00833333333332249))) - $50 + $48 * .16666666666666632));
     break block;
    case 1:
     $51 = $5_1 * .5;
     $52 = 1.0 - $51;
     $66 = -($52 + (1.0 - $52 - $51 + ($5_1 * ($5_1 * ($5_1 * ($5_1 * 2.480158728947673e-05 + -.001388888888887411) + .0416666666666666) + $49 * $49 * ($5_1 * ($5_1 * -1.1359647557788195e-11 + 2.087572321298175e-09) + -2.7557314351390663e-07)) - $48 * $50)));
     break block;
    case 2:
     break block44;
    };
   }
   $1750 = $48;
   $48 = $48 * $5_1;
   $66 = $1750 - ($5_1 * ($50 * .5 - $48 * ($5_1 * $49 * ($5_1 * 1.58969099521155e-10 + -2.5050760253406863e-08) + ($5_1 * ($5_1 * 2.7557313707070068e-06 + -1.984126982985795e-04) + .00833333333332249))) - $50 + $48 * .16666666666666632);
  }
  global$0 = $14_1 + 16 | 0;
  return +$66;
 }
 
 function $24($0_1, $1_1, $2_1, $3_1, $4_1, $5_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = +$5_1;
  var $6_1 = 0, i64toi32_i32$0 = 0, $17_1 = 0.0, i64toi32_i32$1 = 0, $9_1 = 0, i64toi32_i32$2 = 0, $8_1 = 0, $10_1 = 0, $18_1 = 0.0, $11_1 = 0, $21_1 = 0.0, $19_1 = 0.0, $20_1 = 0.0, $12_1 = 0, $13_1 = 0, $7_1 = 0, $14_1 = 0, $22_1 = 0.0, $23_1 = 0.0, $15_1 = 0, $25_1 = Math_fround(0), $266 = Math_fround(0), $24_1 = 0.0, $121 = 0.0, $131 = 0.0, $184 = 0, $187 = 0, $190 = 0, $193 = 0, $196 = 0, $16_1 = 0, $26_1 = Math_fround(0), $252 = 0, $27_1 = Math_fround(0);
  $6_1 = global$0 - 48 | 0;
  global$0 = $6_1;
  $13_1 = Math_imul($1_1, $3_1);
  $15_1 = $36((($13_1 << 1 | 0) & 131068 | 0) + 4 | 0 | 0) | 0;
  i64toi32_i32$1 = $6_1;
  i64toi32_i32$0 = 0;
  HEAP32[($6_1 + 8 | 0) >> 2] = 0;
  HEAP32[($6_1 + 12 | 0) >> 2] = i64toi32_i32$0;
  i64toi32_i32$1 = $6_1;
  i64toi32_i32$0 = 0;
  HEAP32[$6_1 >> 2] = 0;
  HEAP32[($6_1 + 4 | 0) >> 2] = i64toi32_i32$0;
  HEAPF64[($6_1 + 16 | 0) >> 3] = +Math_fround(HEAPF32[$4_1 >> 2]);
  HEAPF64[($6_1 + 24 | 0) >> 3] = +Math_fround(HEAPF32[($4_1 + 4 | 0) >> 2]);
  HEAPF64[($6_1 + 32 | 0) >> 3] = +Math_fround(HEAPF32[($4_1 + 8 | 0) >> 2]);
  $17_1 = +Math_fround(HEAPF32[($4_1 + 12 | 0) >> 2]);
  HEAPF64[($6_1 + 40 | 0) >> 3] = $17_1;
  $11_1 = Math_imul($1_1, $2_1);
  $14_1 = $11_1 >>> 1 | 0;
  $7_1 = $6_1 | 8 | 0;
  $24_1 = +($3_1 >>> 0);
  $8_1 = $15_1;
  label1 : while (1) {
   $19_1 = +HEAPF64[($6_1 + 32 | 0) >> 3];
   $22_1 = +HEAPF64[$6_1 >> 3];
   $23_1 = +HEAPF64[($6_1 + 16 | 0) >> 3];
   $20_1 = +HEAPF64[($6_1 + 24 | 0) >> 3];
   $18_1 = +HEAPF64[($6_1 + 8 | 0) >> 3];
   if (($10_1 | 0) == (($9_1 | 0) / ($3_1 | 0) | 0 | 0)) {
    $21_1 = $20_1 - $18_1;
    $18_1 = $18_1 + $20_1;
    $20_1 = ($18_1 * -4.0 + ($23_1 * 6.0 + ($22_1 + $19_1))) * .041666666666666664;
    $18_1 = $18_1 * .5 - $23_1 - $20_1;
    $121 = $21_1 * 2.5 + (($20_1 * 9.0 + $18_1) * -9.0 + ($17_1 - $23_1));
    $17_1 = $19_1 - $22_1;
    $19_1 = ($121 - ($17_1 + $17_1)) * .008333333333333333;
    $131 = $21_1 * .5 - $19_1;
    $21_1 = ($19_1 * -60.0 + ($17_1 - ($21_1 + $21_1))) * .08333333333333333;
    $22_1 = $131 - $21_1;
    label : while (1) {
     $17_1 = +(($9_1 | 0) % ($3_1 | 0) | 0 | 0) / $24_1;
     HEAPF32[$8_1 >> 2] = Math_fround((((($19_1 * $17_1 + $20_1) * $17_1 + $21_1) * $17_1 + $18_1) * $17_1 + $22_1) * $17_1 + $23_1);
     $8_1 = $8_1 + 4 | 0;
     $9_1 = $2_1 + $9_1 | 0;
     if ((($9_1 | 0) / ($3_1 | 0) | 0 | 0) == ($10_1 | 0)) {
      continue label
     }
     break label;
    };
   }
   i64toi32_i32$2 = $7_1;
   i64toi32_i32$0 = HEAP32[i64toi32_i32$2 >> 2] | 0;
   i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
   $184 = i64toi32_i32$0;
   i64toi32_i32$0 = $6_1;
   HEAP32[$6_1 >> 2] = $184;
   HEAP32[($6_1 + 4 | 0) >> 2] = i64toi32_i32$1;
   i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 8 | 0) >> 2] | 0;
   i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 12 | 0) >> 2] | 0;
   $187 = i64toi32_i32$1;
   i64toi32_i32$1 = $6_1;
   HEAP32[($6_1 + 8 | 0) >> 2] = $187;
   HEAP32[($6_1 + 12 | 0) >> 2] = i64toi32_i32$0;
   i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 16 | 0) >> 2] | 0;
   i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 20 | 0) >> 2] | 0;
   $190 = i64toi32_i32$0;
   i64toi32_i32$0 = $6_1;
   HEAP32[($6_1 + 16 | 0) >> 2] = $190;
   HEAP32[($6_1 + 20 | 0) >> 2] = i64toi32_i32$1;
   i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 24 | 0) >> 2] | 0;
   i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 28 | 0) >> 2] | 0;
   $193 = i64toi32_i32$1;
   i64toi32_i32$1 = $6_1;
   HEAP32[($6_1 + 24 | 0) >> 2] = $193;
   HEAP32[($6_1 + 28 | 0) >> 2] = i64toi32_i32$0;
   i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 32 | 0) >> 2] | 0;
   i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 36 | 0) >> 2] | 0;
   $196 = i64toi32_i32$0;
   i64toi32_i32$0 = $6_1;
   HEAP32[($6_1 + 32 | 0) >> 2] = $196;
   HEAP32[($6_1 + 36 | 0) >> 2] = i64toi32_i32$1;
   $17_1 = 0.0;
   $12_1 = $10_1 + 4 | 0;
   if ($12_1 >>> 0 < $11_1 >>> 0) {
    $17_1 = +Math_fround(HEAPF32[($4_1 + (($12_1 >>> 0 > $14_1 >>> 0 ? $11_1 - $12_1 | 0 : $12_1) << 2 | 0) | 0) >> 2])
   }
   HEAPF64[($6_1 + 40 | 0) >> 3] = $17_1;
   $10_1 = $10_1 + 1 | 0;
   if (($10_1 | 0) != ($14_1 | 0)) {
    continue label1
   }
   break label1;
  };
  if (!($13_1 & 1 | 0)) {
   HEAPF32[$8_1 >> 2] = Math_fround(+HEAPF64[($6_1 + 16 | 0) >> 3])
  }
  $7_1 = $13_1 - 1 | 0;
  $12_1 = $3_1 + 1 | 0;
  $14_1 = $13_1 >>> 1 | 0;
  $11_1 = 0;
  $16_1 = 0 - ($1_1 << 3 | 0) | 0;
  $0_1 = $0_1 + (Math_imul($1_1, $3_1 - 1 | 0) << 3 | 0) | 0;
  $26_1 = Math_fround($5_1);
  $4_1 = 1;
  label3 : while (1) {
   $10_1 = $4_1;
   $9_1 = $7_1;
   $8_1 = $0_1;
   $2_1 = $12_1;
   label2 : while (1) {
    $252 = $8_1 + 4 | 0;
    if ($9_1 >>> 0 < $13_1 >>> 0) {
     $266 = Math_fround(HEAPF32[($15_1 + (($9_1 >>> 0 > $14_1 >>> 0 ? $10_1 : $9_1) << 2 | 0) | 0) >> 2])
    } else {
     $266 = Math_fround(0.0)
    }
    $25_1 = Math_fround($266 * $26_1);
    HEAPF32[$252 >> 2] = $25_1;
    HEAPF32[$8_1 >> 2] = Math_fround($27_1 - $25_1);
    $10_1 = $10_1 + 1 | 0;
    $9_1 = $9_1 - 1 | 0;
    $8_1 = $8_1 + $16_1 | 0;
    $27_1 = $25_1;
    $2_1 = $2_1 - 1 | 0;
    if (($2_1 | 0) > (1 | 0)) {
     continue label2
    }
    break label2;
   };
   $4_1 = $3_1 + $4_1 | 0;
   $7_1 = $7_1 - $3_1 | 0;
   $0_1 = $0_1 + 8 | 0;
   $11_1 = $11_1 + 1 | 0;
   if (($11_1 | 0) != ($1_1 | 0)) {
    continue label3
   }
   break label3;
  };
  $37($15_1 | 0);
  global$0 = $6_1 + 48 | 0;
 }
 
 function $25($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = +$1_1;
  $2_1 = $2_1 | 0;
  var i64toi32_i32$1 = 0, i64toi32_i32$4 = 0, i64toi32_i32$0 = 0, i64toi32_i32$5 = 0, i64toi32_i32$7 = 0.0, i64toi32_i32$2 = 0, i64toi32_i32$3 = 0, $6_1 = 0.0, $7_1 = 0, $3_1 = 0, $3$hi = 0, $4$hi = 0, i64toi32_i32$6 = 0, $4_1 = 0, $29$hi = 0, $174$hi = 0, $53 = 0, $54 = 0, $29_1 = 0, $55 = 0, $56 = 0, $57 = 0, $70 = 0, $8_1 = 0, $58 = 0, $59 = 0, $121 = 0, $121$hi = 0, $60 = 0, $61 = 0, $141 = 0, $141$hi = 0, $62 = 0, $63 = 0, $154 = 0, $154$hi = 0, $64 = 0, $65 = 0, $174 = 0, $66 = 0, $67 = 0, $68 = 0, $5_1 = 0, $5$hi = 0, $17_1 = 0, $17$hi = 0, $18_1 = 0, $18$hi = 0, $32_1 = 0, $32$hi = 0, $36$hi = 0, $45$hi = 0, $46 = 0, $111 = 0, $130 = 0, $143 = 0, $162 = 0, $162$hi = 0, $163 = 0, $163$hi = 0, $177 = 0, $177$hi = 0, $181$hi = 0, $192 = 0, $196$hi = 0, $197 = 0;
  block2 : {
   block : {
    if ($2_1) {
     HEAP32[($0_1 + 16 | 0) >> 2] = $2_1;
     i64toi32_i32$1 = $2_1 >> 1 | 0;
     i64toi32_i32$0 = i64toi32_i32$1 >> 31 | 0;
     $3_1 = i64toi32_i32$1;
     $3$hi = i64toi32_i32$0;
     i64toi32_i32$0 = 0;
     i64toi32_i32$2 = 0;
     i64toi32_i32$1 = $3$hi;
     i64toi32_i32$3 = $3_1;
     i64toi32_i32$4 = i64toi32_i32$2 - i64toi32_i32$3 | 0;
     i64toi32_i32$6 = i64toi32_i32$2 >>> 0 < i64toi32_i32$3 >>> 0;
     i64toi32_i32$5 = i64toi32_i32$6 + i64toi32_i32$1 | 0;
     i64toi32_i32$5 = i64toi32_i32$0 - i64toi32_i32$5 | 0;
     $5_1 = i64toi32_i32$4;
     $5$hi = i64toi32_i32$5;
     $17_1 = i64toi32_i32$4;
     $17$hi = i64toi32_i32$5;
     i64toi32_i32$5 = i64toi32_i32$1;
     $18_1 = i64toi32_i32$3;
     $18$hi = i64toi32_i32$1;
     $6_1 = $1_1 * +HEAPF64[($0_1 + 184 | 0) >> 3] + .5;
     if (Math_abs($6_1) < 9223372036854775808.0) {
      i64toi32_i32$7 = $6_1;
      if (Math_abs(i64toi32_i32$7) >= 1.0) {
       if (i64toi32_i32$7 > 0.0) {
        $53 = ~~Math_min(Math_floor(i64toi32_i32$7 / 4294967296.0), 4294967296.0 - 1.0) >>> 0
       } else {
        $53 = ~~Math_ceil((i64toi32_i32$7 - +(~~i64toi32_i32$7 >>> 0 >>> 0)) / 4294967296.0) >>> 0
       }
       $54 = $53;
      } else {
       $54 = 0
      }
      i64toi32_i32$5 = $54;
      $29_1 = ~~i64toi32_i32$7 >>> 0;
      $29$hi = i64toi32_i32$5;
     } else {
      i64toi32_i32$5 = -2147483648;
      $29_1 = 0;
      $29$hi = i64toi32_i32$5;
     }
     i64toi32_i32$5 = $29$hi;
     i64toi32_i32$0 = $0_1;
     i64toi32_i32$5 = HEAP32[(i64toi32_i32$0 + 152 | 0) >> 2] | 0;
     i64toi32_i32$2 = HEAP32[(i64toi32_i32$0 + 156 | 0) >> 2] | 0;
     $32_1 = i64toi32_i32$5;
     $32$hi = i64toi32_i32$2;
     i64toi32_i32$2 = $29$hi;
     i64toi32_i32$0 = $29_1;
     i64toi32_i32$5 = $32$hi;
     i64toi32_i32$3 = $32_1;
     i64toi32_i32$1 = i64toi32_i32$0 - i64toi32_i32$3 | 0;
     i64toi32_i32$6 = i64toi32_i32$0 >>> 0 < i64toi32_i32$3 >>> 0;
     i64toi32_i32$4 = i64toi32_i32$6 + i64toi32_i32$5 | 0;
     i64toi32_i32$4 = i64toi32_i32$2 - i64toi32_i32$4 | 0;
     $4_1 = i64toi32_i32$1;
     $4$hi = i64toi32_i32$4;
     i64toi32_i32$2 = i64toi32_i32$1;
     i64toi32_i32$0 = 0;
     i64toi32_i32$3 = 0;
     if ((i64toi32_i32$4 | 0) < (i64toi32_i32$0 | 0)) {
      $55 = 1
     } else {
      if ((i64toi32_i32$4 | 0) <= (i64toi32_i32$0 | 0)) {
       if (i64toi32_i32$2 >>> 0 >= i64toi32_i32$3 >>> 0) {
        $56 = 0
       } else {
        $56 = 1
       }
       $57 = $56;
      } else {
       $57 = 0
      }
      $55 = $57;
     }
     i64toi32_i32$5 = $55;
     i64toi32_i32$2 = $17$hi;
     i64toi32_i32$4 = $18$hi;
     i64toi32_i32$0 = i64toi32_i32$5 ? $17_1 : $18_1;
     i64toi32_i32$3 = i64toi32_i32$5 ? i64toi32_i32$2 : i64toi32_i32$4;
     $36$hi = i64toi32_i32$3;
     i64toi32_i32$3 = $4$hi;
     i64toi32_i32$3 = $36$hi;
     i64toi32_i32$5 = i64toi32_i32$0;
     i64toi32_i32$0 = $4$hi;
     i64toi32_i32$2 = $4_1;
     i64toi32_i32$4 = i64toi32_i32$5 + i64toi32_i32$2 | 0;
     i64toi32_i32$1 = i64toi32_i32$3 + i64toi32_i32$0 | 0;
     if (i64toi32_i32$4 >>> 0 < i64toi32_i32$2 >>> 0) {
      i64toi32_i32$1 = i64toi32_i32$1 + 1 | 0
     }
     $4_1 = i64toi32_i32$4;
     $4$hi = i64toi32_i32$1;
     i64toi32_i32$3 = i64toi32_i32$4;
     i64toi32_i32$5 = 0;
     i64toi32_i32$2 = -2147483648;
     i64toi32_i32$0 = i64toi32_i32$4 + i64toi32_i32$2 | 0;
     i64toi32_i32$4 = i64toi32_i32$1 + i64toi32_i32$5 | 0;
     if (i64toi32_i32$0 >>> 0 < i64toi32_i32$2 >>> 0) {
      i64toi32_i32$4 = i64toi32_i32$4 + 1 | 0
     }
     i64toi32_i32$1 = i64toi32_i32$0;
     i64toi32_i32$3 = 1;
     i64toi32_i32$2 = 0;
     if (i64toi32_i32$4 >>> 0 > i64toi32_i32$3 >>> 0 | ((i64toi32_i32$4 | 0) == (i64toi32_i32$3 | 0) & i64toi32_i32$1 >>> 0 >= i64toi32_i32$2 >>> 0 | 0) | 0) {
      i64toi32_i32$1 = $4$hi;
      i64toi32_i32$4 = $2_1;
      i64toi32_i32$1 = i64toi32_i32$4 >> 31 | 0;
      $45$hi = i64toi32_i32$1;
      i64toi32_i32$1 = $4$hi;
      i64toi32_i32$4 = $45$hi;
      i64toi32_i32$4 = __wasm_i64_sdiv($4_1 | 0, i64toi32_i32$1 | 0, $2_1 | 0, i64toi32_i32$4 | 0) | 0;
      i64toi32_i32$1 = i64toi32_i32$HIGH_BITS;
      $46 = i64toi32_i32$4;
      i64toi32_i32$4 = $0_1;
      HEAP32[(i64toi32_i32$4 + 160 | 0) >> 2] = $46;
      HEAP32[(i64toi32_i32$4 + 164 | 0) >> 2] = i64toi32_i32$1;
      break block;
     }
     i64toi32_i32$1 = $4$hi;
     $7_1 = ($4_1 | 0) / ($2_1 | 0) | 0;
     i64toi32_i32$4 = $7_1;
     i64toi32_i32$1 = i64toi32_i32$4 >> 31 | 0;
     i64toi32_i32$4 = $0_1;
     HEAP32[(i64toi32_i32$4 + 160 | 0) >> 2] = $7_1;
     HEAP32[(i64toi32_i32$4 + 164 | 0) >> 2] = i64toi32_i32$1;
     if ($7_1) {
      break block
     }
     i64toi32_i32$1 = 0;
     HEAP32[(i64toi32_i32$4 + 208 | 0) >> 2] = 0;
     HEAP32[(i64toi32_i32$4 + 212 | 0) >> 2] = i64toi32_i32$1;
     i64toi32_i32$1 = 0;
     HEAP32[(i64toi32_i32$4 + 32 | 0) >> 2] = 0;
     HEAP32[(i64toi32_i32$4 + 36 | 0) >> 2] = i64toi32_i32$1;
     HEAP32[(i64toi32_i32$4 + 16 | 0) >> 2] = 0;
     return;
    }
    block1 : {
     if (+HEAPF64[($0_1 + 40 | 0) >> 3] != 0.0) {
      $2_1 = -1;
      $6_1 = Math_floor(+$11(+$1_1) / .6931471805599453);
      if (Math_abs($6_1) < 2147483647.0) {
       $70 = ~~$6_1
      } else {
       $70 = -2147483648
      }
      $7_1 = $70;
      if (($7_1 | 0) >= (0 | 0)) {
       $2_1 = (HEAP32[$0_1 >> 2] | 0) - 1 | 0;
       $2_1 = ($2_1 | 0) > ($7_1 | 0) ? $7_1 : $2_1;
      }
      HEAP32[($0_1 + 172 | 0) >> 2] = 0;
      HEAP32[($0_1 + 176 | 0) >> 2] = $2_1;
      $8_1 = ($2_1 | 0) >= (0 | 0);
      HEAP8[($0_1 + 180 | 0) >> 0] = $8_1;
      $7_1 = (HEAP32[($0_1 + 48 | 0) >> 2] | 0) + Math_imul($2_1, 48) | 0;
      $6_1 = +HEAPF64[($7_1 + 24 | 0) >> 3];
      HEAPF64[($0_1 + 184 | 0) >> 3] = $6_1;
      HEAP32[($0_1 + 168 | 0) >> 2] = ((HEAP32[$7_1 >> 2] | 0) + (HEAP32[($7_1 + 12 | 0) >> 2] | 0) | 0) + 960 | 0;
      if ($8_1) {
       $6_1 = $6_1 * .5;
       HEAPF64[($0_1 + 184 | 0) >> 3] = $6_1;
      }
      $111 = $0_1;
      $1_1 = $1_1 * $6_1 + .5;
      if (Math_abs($1_1) < 9223372036854775808.0) {
       i64toi32_i32$7 = $1_1;
       if (Math_abs(i64toi32_i32$7) >= 1.0) {
        if (i64toi32_i32$7 > 0.0) {
         $58 = ~~Math_min(Math_floor(i64toi32_i32$7 / 4294967296.0), 4294967296.0 - 1.0) >>> 0
        } else {
         $58 = ~~Math_ceil((i64toi32_i32$7 - +(~~i64toi32_i32$7 >>> 0 >>> 0)) / 4294967296.0) >>> 0
        }
        $59 = $58;
       } else {
        $59 = 0
       }
       i64toi32_i32$1 = $59;
       $121 = ~~i64toi32_i32$7 >>> 0;
       $121$hi = i64toi32_i32$1;
      } else {
       i64toi32_i32$1 = -2147483648;
       $121 = 0;
       $121$hi = i64toi32_i32$1;
      }
      i64toi32_i32$1 = $121$hi;
      $3_1 = $121;
      $3$hi = i64toi32_i32$1;
      i64toi32_i32$4 = $111;
      HEAP32[(i64toi32_i32$4 + 152 | 0) >> 2] = $3_1;
      HEAP32[(i64toi32_i32$4 + 156 | 0) >> 2] = i64toi32_i32$1;
      HEAP32[($0_1 + 144 | 0) >> 2] = $3_1 >>> 1 | 0;
      break block1;
     }
     if (HEAP32[($0_1 + 12 | 0) >> 2] | 0) {
      $130 = $0_1;
      $6_1 = $1_1 * +HEAPF64[($0_1 + 232 | 0) >> 3] + .5;
      if (Math_abs($6_1) < 9223372036854775808.0) {
       i64toi32_i32$7 = $6_1;
       if (Math_abs(i64toi32_i32$7) >= 1.0) {
        if (i64toi32_i32$7 > 0.0) {
         $60 = ~~Math_min(Math_floor(i64toi32_i32$7 / 4294967296.0), 4294967296.0 - 1.0) >>> 0
        } else {
         $60 = ~~Math_ceil((i64toi32_i32$7 - +(~~i64toi32_i32$7 >>> 0 >>> 0)) / 4294967296.0) >>> 0
        }
        $61 = $60;
       } else {
        $61 = 0
       }
       i64toi32_i32$1 = $61;
       $141 = ~~i64toi32_i32$7 >>> 0;
       $141$hi = i64toi32_i32$1;
      } else {
       i64toi32_i32$1 = -2147483648;
       $141 = 0;
       $141$hi = i64toi32_i32$1;
      }
      i64toi32_i32$1 = $141$hi;
      i64toi32_i32$4 = $130;
      HEAP32[(i64toi32_i32$4 + 200 | 0) >> 2] = $141;
      HEAP32[(i64toi32_i32$4 + 204 | 0) >> 2] = i64toi32_i32$1;
     }
     $143 = $0_1;
     $1_1 = $1_1 * +HEAPF64[($0_1 + 184 | 0) >> 3] + .5;
     if (Math_abs($1_1) < 9223372036854775808.0) {
      i64toi32_i32$7 = $1_1;
      if (Math_abs(i64toi32_i32$7) >= 1.0) {
       if (i64toi32_i32$7 > 0.0) {
        $62 = ~~Math_min(Math_floor(i64toi32_i32$7 / 4294967296.0), 4294967296.0 - 1.0) >>> 0
       } else {
        $62 = ~~Math_ceil((i64toi32_i32$7 - +(~~i64toi32_i32$7 >>> 0 >>> 0)) / 4294967296.0) >>> 0
       }
       $63 = $62;
      } else {
       $63 = 0
      }
      i64toi32_i32$1 = $63;
      $154 = ~~i64toi32_i32$7 >>> 0;
      $154$hi = i64toi32_i32$1;
     } else {
      i64toi32_i32$1 = -2147483648;
      $154 = 0;
      $154$hi = i64toi32_i32$1;
     }
     i64toi32_i32$1 = $154$hi;
     i64toi32_i32$4 = $143;
     HEAP32[(i64toi32_i32$4 + 152 | 0) >> 2] = $154;
     HEAP32[(i64toi32_i32$4 + 156 | 0) >> 2] = i64toi32_i32$1;
    }
    i64toi32_i32$4 = $0_1;
    i64toi32_i32$1 = 0;
    HEAP32[(i64toi32_i32$4 + 40 | 0) >> 2] = 0;
    HEAP32[(i64toi32_i32$4 + 44 | 0) >> 2] = i64toi32_i32$1;
    break block2;
   }
   HEAPF64[($0_1 + 32 | 0) >> 3] = $1_1;
   if (!(HEAP32[($0_1 + 12 | 0) >> 2] | 0)) {
    break block2
   }
   i64toi32_i32$1 = $5$hi;
   $162 = $5_1;
   $162$hi = i64toi32_i32$1;
   i64toi32_i32$1 = $3$hi;
   $163 = $3_1;
   $163$hi = i64toi32_i32$1;
   $1_1 = $1_1 * +HEAPF64[($0_1 + 232 | 0) >> 3] + .5;
   if (Math_abs($1_1) < 9223372036854775808.0) {
    i64toi32_i32$7 = $1_1;
    if (Math_abs(i64toi32_i32$7) >= 1.0) {
     if (i64toi32_i32$7 > 0.0) {
      $64 = ~~Math_min(Math_floor(i64toi32_i32$7 / 4294967296.0), 4294967296.0 - 1.0) >>> 0
     } else {
      $64 = ~~Math_ceil((i64toi32_i32$7 - +(~~i64toi32_i32$7 >>> 0 >>> 0)) / 4294967296.0) >>> 0
     }
     $65 = $64;
    } else {
     $65 = 0
    }
    i64toi32_i32$1 = $65;
    $174 = ~~i64toi32_i32$7 >>> 0;
    $174$hi = i64toi32_i32$1;
   } else {
    i64toi32_i32$1 = -2147483648;
    $174 = 0;
    $174$hi = i64toi32_i32$1;
   }
   i64toi32_i32$1 = $174$hi;
   i64toi32_i32$2 = $0_1;
   i64toi32_i32$1 = HEAP32[($0_1 + 200 | 0) >> 2] | 0;
   i64toi32_i32$4 = HEAP32[($0_1 + 204 | 0) >> 2] | 0;
   $177 = i64toi32_i32$1;
   $177$hi = i64toi32_i32$4;
   i64toi32_i32$4 = $174$hi;
   i64toi32_i32$2 = $174;
   i64toi32_i32$1 = $177$hi;
   i64toi32_i32$3 = $177;
   i64toi32_i32$5 = i64toi32_i32$2 - i64toi32_i32$3 | 0;
   i64toi32_i32$6 = i64toi32_i32$2 >>> 0 < i64toi32_i32$3 >>> 0;
   i64toi32_i32$0 = i64toi32_i32$6 + i64toi32_i32$1 | 0;
   i64toi32_i32$0 = i64toi32_i32$4 - i64toi32_i32$0 | 0;
   $3_1 = i64toi32_i32$5;
   $3$hi = i64toi32_i32$0;
   i64toi32_i32$4 = i64toi32_i32$5;
   i64toi32_i32$2 = 0;
   i64toi32_i32$3 = 0;
   if ((i64toi32_i32$0 | 0) < (i64toi32_i32$2 | 0)) {
    $66 = 1
   } else {
    if ((i64toi32_i32$0 | 0) <= (i64toi32_i32$2 | 0)) {
     if (i64toi32_i32$4 >>> 0 >= i64toi32_i32$3 >>> 0) {
      $67 = 0
     } else {
      $67 = 1
     }
     $68 = $67;
    } else {
     $68 = 0
    }
    $66 = $68;
   }
   i64toi32_i32$1 = $66;
   i64toi32_i32$4 = $162$hi;
   i64toi32_i32$0 = $163$hi;
   i64toi32_i32$2 = i64toi32_i32$1 ? $162 : $163;
   i64toi32_i32$3 = i64toi32_i32$1 ? i64toi32_i32$4 : i64toi32_i32$0;
   $181$hi = i64toi32_i32$3;
   i64toi32_i32$3 = $3$hi;
   i64toi32_i32$3 = $181$hi;
   i64toi32_i32$1 = i64toi32_i32$2;
   i64toi32_i32$2 = $3$hi;
   i64toi32_i32$4 = $3_1;
   i64toi32_i32$0 = i64toi32_i32$1 + i64toi32_i32$4 | 0;
   i64toi32_i32$5 = i64toi32_i32$3 + i64toi32_i32$2 | 0;
   if (i64toi32_i32$0 >>> 0 < i64toi32_i32$4 >>> 0) {
    i64toi32_i32$5 = i64toi32_i32$5 + 1 | 0
   }
   $3_1 = i64toi32_i32$0;
   $3$hi = i64toi32_i32$5;
   i64toi32_i32$3 = i64toi32_i32$0;
   i64toi32_i32$1 = 0;
   i64toi32_i32$4 = -2147483648;
   i64toi32_i32$2 = i64toi32_i32$0 + i64toi32_i32$4 | 0;
   i64toi32_i32$0 = i64toi32_i32$5 + i64toi32_i32$1 | 0;
   if (i64toi32_i32$2 >>> 0 < i64toi32_i32$4 >>> 0) {
    i64toi32_i32$0 = i64toi32_i32$0 + 1 | 0
   }
   i64toi32_i32$5 = i64toi32_i32$2;
   i64toi32_i32$3 = 0;
   i64toi32_i32$4 = -1;
   if (i64toi32_i32$0 >>> 0 < i64toi32_i32$3 >>> 0 | ((i64toi32_i32$0 | 0) == (i64toi32_i32$3 | 0) & i64toi32_i32$5 >>> 0 <= i64toi32_i32$4 >>> 0 | 0) | 0) {
    i64toi32_i32$5 = $3$hi;
    i64toi32_i32$0 = ($3_1 | 0) / ($2_1 | 0) | 0;
    i64toi32_i32$5 = i64toi32_i32$0 >> 31 | 0;
    $192 = i64toi32_i32$0;
    i64toi32_i32$0 = $0_1;
    HEAP32[(i64toi32_i32$0 + 208 | 0) >> 2] = $192;
    HEAP32[(i64toi32_i32$0 + 212 | 0) >> 2] = i64toi32_i32$5;
    return;
   }
   i64toi32_i32$5 = $3$hi;
   i64toi32_i32$0 = $2_1;
   i64toi32_i32$5 = i64toi32_i32$0 >> 31 | 0;
   $196$hi = i64toi32_i32$5;
   i64toi32_i32$5 = $3$hi;
   i64toi32_i32$0 = $196$hi;
   i64toi32_i32$0 = __wasm_i64_sdiv($3_1 | 0, i64toi32_i32$5 | 0, $2_1 | 0, i64toi32_i32$0 | 0) | 0;
   i64toi32_i32$5 = i64toi32_i32$HIGH_BITS;
   $197 = i64toi32_i32$0;
   i64toi32_i32$0 = $0_1;
   HEAP32[(i64toi32_i32$0 + 208 | 0) >> 2] = $197;
   HEAP32[(i64toi32_i32$0 + 212 | 0) >> 2] = i64toi32_i32$5;
  }
 }
 
 function $26() {
  wasm2js_trap();
 }
 
 function $27($0_1) {
  $0_1 = $0_1 | 0;
  return Math_fround(Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 480 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 480 | 0) >> 2])) * Math_fround(-5.285501174512319e-07)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 476 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 476 | 0) >> 2])) * Math_fround(4.903286480839597e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 472 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 472 | 0) >> 2])) * Math_fround(1.9846236682496965e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 468 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 468 | 0) >> 2])) * Math_fround(3.206084875273518e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 464 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 464 | 0) >> 2])) * Math_fround(2.071333619824145e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 460 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 460 | 0) >> 2])) * Math_fround(-9.387523277837317e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 456 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 456 | 0) >> 2])) * Math_fround(-2.099097218888346e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 452 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 452 | 0) >> 2])) * Math_fround(3.661579967229045e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 448 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 448 | 0) >> 2])) * Math_fround(2.5132903829216957e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 444 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 444 | 0) >> 2])) * Math_fround(2.735620000748895e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 440 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 440 | 0) >> 2])) * Math_fround(-3.0302720915642567e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 436 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 436 | 0) >> 2])) * Math_fround(-1.2107811016903725e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 432 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 432 | 0) >> 2])) * Math_fround(3.460905281826854e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 428 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 428 | 0) >> 2])) * Math_fround(2.4965425836853683e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 424 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 424 | 0) >> 2])) * Math_fround(-3.644624666776508e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 420 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 420 | 0) >> 2])) * Math_fround(-4.119111690670252e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 416 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 416 | 0) >> 2])) * Math_fround(3.427757474128157e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 412 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 412 | 0) >> 2])) * Math_fround(6.0210157244000584e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 408 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 408 | 0) >> 2])) * Math_fround(-2.6592530048219487e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 404 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 404 | 0) >> 2])) * Math_fround(-8.095589146250859e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 400 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 400 | 0) >> 2])) * Math_fround(1.2001512914139312e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 396 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 396 | 0) >> 2])) * Math_fround(1.0185818973695859e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 392 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 392 | 0) >> 2])) * Math_fround(1.0650508556864224e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 388 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 388 | 0) >> 2])) * Math_fround(-1.2083091860404238e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 384 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 384 | 0) >> 2])) * Math_fround(-4.212080602883361e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 380 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 380 | 0) >> 2])) * Math_fround(1.3531804142985493e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 376 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 376 | 0) >> 2])) * Math_fround(8.260905451606959e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 372 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 372 | 0) >> 2])) * Math_fround(-1.4237486175261438e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 368 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 368 | 0) >> 2])) * Math_fround(-1.3158794899936765e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 364 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 364 | 0) >> 2])) * Math_fround(1.388132368447259e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 360 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 360 | 0) >> 2])) * Math_fround(1.876626629382372e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 356 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 356 | 0) >> 2])) * Math_fround(-1.2138997408328578e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 352 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 352 | 0) >> 2])) * Math_fround(-2.484566066414118e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 348 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 348 | 0) >> 2])) * Math_fround(8.705004438525066e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 344 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 344 | 0) >> 2])) * Math_fround(3.105540235992521e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 340 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 340 | 0) >> 2])) * Math_fround(-3.320208270451985e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 336 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 336 | 0) >> 2])) * Math_fround(-3.6950051435269415e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 332 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 332 | 0) >> 2])) * Math_fround(-4.197535236016847e-05)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 328 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 328 | 0) >> 2])) * Math_fround(4.1988398879766464e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 324 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 324 | 0) >> 2])) * Math_fround(1.392226986354217e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 320 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 320 | 0) >> 2])) * Math_fround(-4.554950864985585e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 316 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 316 | 0) >> 2])) * Math_fround(-2.578958810772747e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 312 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 312 | 0) >> 2])) * Math_fround(4.695796815212816e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 308 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 308 | 0) >> 2])) * Math_fround(3.956986765842885e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 304 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 304 | 0) >> 2])) * Math_fround(-4.551744495984167e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 300 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 300 | 0) >> 2])) * Math_fround(-5.484704161062837e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 296 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 296 | 0) >> 2])) * Math_fround(4.0552602149546146e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 292 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 292 | 0) >> 2])) * Math_fround(7.100555812940001e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 288 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 288 | 0) >> 2])) * Math_fround(-3.145730006508529e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 284 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 284 | 0) >> 2])) * Math_fround(-8.722752681933343e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 280 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 280 | 0) >> 2])) * Math_fround(1.774780248524621e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 276 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 276 | 0) >> 2])) * Math_fround(1.0250204941257834e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 272 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 272 | 0) >> 2])) * Math_fround(8.821186384011526e-06)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 268 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 268 | 0) >> 2])) * Math_fround(-1.1564798187464476e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 264 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 264 | 0) >> 2])) * Math_fround(-2.4506778572686017e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 260 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 260 | 0) >> 2])) * Math_fround(1.2535087298601866e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 256 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 256 | 0) >> 2])) * Math_fround(5.291844718158245e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 252 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 252 | 0) >> 2])) * Math_fround(-1.3021404156461358e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 248 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 248 | 0) >> 2])) * Math_fround(-8.558491826988757e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 244 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 244 | 0) >> 2])) * Math_fround(1.2882278533652425e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 240 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 240 | 0) >> 2])) * Math_fround(1.2161827180534601e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 236 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 236 | 0) >> 2])) * Math_fround(-1.1982021387666464e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 232 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 232 | 0) >> 2])) * Math_fround(-1.5975796850398183e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 228 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 228 | 0) >> 2])) * Math_fround(1.0199174284934998e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 224 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 224 | 0) >> 2])) * Math_fround(1.9837121944874525e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 220 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 220 | 0) >> 2])) * Math_fround(-7.435525767505169e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 216 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 216 | 0) >> 2])) * Math_fround(-2.3547252640128136e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 212 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 212 | 0) >> 2])) * Math_fround(3.625278768595308e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 208 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 208 | 0) >> 2])) * Math_fround(.00268763629719615)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 204 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 204 | 0) >> 2])) * Math_fround(1.256073301192373e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 200 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 200 | 0) >> 2])) * Math_fround(-.002956943353638053)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 196 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 196 | 0) >> 2])) * Math_fround(-7.183619309216738e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 192 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 192 | 0) >> 2])) * Math_fround(.003135429695248604)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 188 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 188 | 0) >> 2])) * Math_fround(1.4076106017455459e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 184 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 184 | 0) >> 2])) * Math_fround(-3.1951467972248793e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 180 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 180 | 0) >> 2])) * Math_fround(-2.1790650207549334e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 176 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 176 | 0) >> 2])) * Math_fround(3.1085426453500986e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 172 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 172 | 0) >> 2])) * Math_fround(.003011940745636821)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 168 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 168 | 0) >> 2])) * Math_fround(-2.8496927116066217e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 164 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 164 | 0) >> 2])) * Math_fround(-3.8788490928709507e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 160 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 160 | 0) >> 2])) * Math_fround(.00239558145403862)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 156 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 156 | 0) >> 2])) * Math_fround(.004745918326079845)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 152 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 152 | 0) >> 2])) * Math_fround(-1.7273786943405867e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 148 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 148 | 0) >> 2])) * Math_fround(-.005573143716901541)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 144 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 144 | 0) >> 2])) * Math_fround(8.316441089846194e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 140 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 140 | 0) >> 2])) * Math_fround(.006314937025308609)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 136 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 136 | 0) >> 2])) * Math_fround(2.985988394357264e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 132 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 132 | 0) >> 2])) * Math_fround(-.006920820102095604)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 128 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 128 | 0) >> 2])) * Math_fround(-1.6629844903945923e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 124 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 124 | 0) >> 2])) * Math_fround(.007336183451116085)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 120 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 120 | 0) >> 2])) * Math_fround(.003253171220421791)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 116 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 116 | 0) >> 2])) * Math_fround(-.007502982392907143)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 112 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 112 | 0) >> 2])) * Math_fround(-.005052506923675537)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 108 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 108 | 0) >> 2])) * Math_fround(.007360189221799374)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 104 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 104 | 0) >> 2])) * Math_fround(.007036016788333654)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 100 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 100 | 0) >> 2])) * Math_fround(-.006843729875981808)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 96 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 96 | 0) >> 2])) * Math_fround(-.009170744568109512)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 92 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 92 | 0) >> 2])) * Math_fround(5.8854869566857815e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 88 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 88 | 0) >> 2])) * Math_fround(.011416441760957241)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 84 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 84 | 0) >> 2])) * Math_fround(-.004410688299685717)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 80 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 80 | 0) >> 2])) * Math_fround(-.013726598583161831)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 76 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 76 | 0) >> 2])) * Math_fround(2.3324829526245594e-03)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 72 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 72 | 0) >> 2])) * Math_fround(.01604977808892727)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 68 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 68 | 0) >> 2])) * Math_fround(4.585253482218832e-04)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 + -64 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 64 | 0) >> 2])) * Math_fround(-.018331212922930717)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 60 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 60 | 0) >> 2])) * Math_fround(-.004114341922104359)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 56 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 56 | 0) >> 2])) * Math_fround(.020514609292149544)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 52 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 52 | 0) >> 2])) * Math_fround(.008869274519383907)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 48 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 48 | 0) >> 2])) * Math_fround(-.022544067353010178)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 44 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 44 | 0) >> 2])) * Math_fround(-.015123856253921986)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 40 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 40 | 0) >> 2])) * Math_fround(.02436605468392372)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 36 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 36 | 0) >> 2])) * Math_fround(.023641161620616913)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 32 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 32 | 0) >> 2])) * Math_fround(-.025931356474757195)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 28 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 28 | 0) >> 2])) * Math_fround(-.03607959300279617)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 24 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 24 | 0) >> 2])) * Math_fround(.02719687670469284)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 20 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 20 | 0) >> 2])) * Math_fround(.05680295452475548)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 16 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 16 | 0) >> 2])) * Math_fround(-.02812729775905609)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 12 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 12 | 0) >> 2])) * Math_fround(-.10192703455686569)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 8 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 8 | 0) >> 2])) * Math_fround(.028696339577436447)) + Math_fround(Math_fround(Math_fround(Math_fround(HEAPF32[($0_1 - 4 | 0) >> 2]) + Math_fround(HEAPF32[($0_1 + 4 | 0) >> 2])) * Math_fround(.3169075548648834)) + Math_fround(Math_fround(HEAPF32[$0_1 >> 2]) * Math_fround(.4711121618747711)))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))));
 }
 
 function $28($0_1, $1_1, $2_1) {
  $0_1 = +$0_1;
  $1_1 = +$1_1;
  $2_1 = $2_1 | 0;
  var i64toi32_i32$1 = 0, i64toi32_i32$0 = 0, $4_1 = 0, $3_1 = 0, $5_1 = 0, i64toi32_i32$2 = 0, $123$hi = 0, $127$hi = 0, $18_1 = 0, $6_1 = 0, $6$hi = 0, $132 = 0, $134 = 0, $136 = 0, $138 = 0, $140 = 0;
  block9 : {
   block : {
    $3_1 = $2(200 | 0, 1 | 0) | 0;
    if (!$3_1) {
     break block
    }
    i64toi32_i32$1 = $3_1;
    i64toi32_i32$0 = -2147483616;
    HEAP32[(i64toi32_i32$1 + 56 | 0) >> 2] = 0;
    HEAP32[(i64toi32_i32$1 + 60 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$0 = 1072693248;
    HEAP32[(i64toi32_i32$1 + 48 | 0) >> 2] = 0;
    HEAP32[(i64toi32_i32$1 + 52 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$0 = 1072588390;
    HEAP32[(i64toi32_i32$1 + 40 | 0) >> 2] = 1717986918;
    HEAP32[(i64toi32_i32$1 + 44 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$0 = 1078525952;
    HEAP32[(i64toi32_i32$1 + 32 | 0) >> 2] = 0;
    HEAP32[(i64toi32_i32$1 + 36 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$0 = 1077149696;
    HEAP32[(i64toi32_i32$1 + 24 | 0) >> 2] = 0;
    HEAP32[(i64toi32_i32$1 + 28 | 0) >> 2] = i64toi32_i32$0;
    $0_1 = $0_1 != 0.0 ? $0_1 : -1.0;
    HEAPF64[(i64toi32_i32$1 + 8 | 0) >> 3] = $0_1;
    i64toi32_i32$0 = 0;
    HEAP32[(i64toi32_i32$1 + 104 | 0) >> 2] = 0;
    HEAP32[(i64toi32_i32$1 + 108 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$0 = 1;
    HEAP32[(i64toi32_i32$1 + 96 | 0) >> 2] = 400;
    HEAP32[(i64toi32_i32$1 + 100 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$0 = 17;
    HEAP32[(i64toi32_i32$1 + 88 | 0) >> 2] = 10;
    HEAP32[(i64toi32_i32$1 + 92 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$0 = 1072693248;
    HEAP32[(i64toi32_i32$1 + 72 | 0) >> 2] = 0;
    HEAP32[(i64toi32_i32$1 + 76 | 0) >> 2] = i64toi32_i32$0;
    HEAP32[i64toi32_i32$1 >> 2] = $2_1;
    block1 : {
     $4_1 = $29(65836 | 0) | 0;
     if (!$4_1) {
      break block1
     }
     $4_1 = $30($4_1 | 0) | 0;
     if (($4_1 - 16 | 0) >>> 0 < -8 >>> 0) {
      break block1
     }
     HEAP32[(i64toi32_i32$1 + 88 | 0) >> 2] = $4_1;
    }
    block2 : {
     $4_1 = $29(65854 | 0) | 0;
     if (!$4_1) {
      break block2
     }
     $4_1 = $30($4_1 | 0) | 0;
     if (($4_1 - 21 | 0) >>> 0 < -13 >>> 0) {
      break block2
     }
     HEAP32[($3_1 + 92 | 0) >> 2] = $4_1;
    }
    block3 : {
     $4_1 = $29(65874 | 0) | 0;
     if (!$4_1) {
      break block3
     }
     $4_1 = $30($4_1 | 0) | 0;
     if (($4_1 - 801 | 0) >>> 0 < -701 >>> 0) {
      break block3
     }
     HEAP32[($3_1 + 96 | 0) >> 2] = $4_1;
    }
    block4 : {
     $4_1 = $29(65786 | 0) | 0;
     if (!$4_1) {
      break block4
     }
     $4_1 = $30($4_1 | 0) | 0;
     if ($4_1 >>> 0 > 64 >>> 0) {
      break block4
     }
     HEAP32[($3_1 + 100 | 0) >> 2] = $4_1;
    }
    $4_1 = 0;
    block5 : {
     $5_1 = $29(65803 | 0) | 0;
     if (!$5_1) {
      break block5
     }
     $5_1 = $30($5_1 | 0) | 0;
     if ($5_1 >>> 0 > 3 >>> 0) {
      break block5
     }
     HEAP32[($3_1 + 108 | 0) >> 2] = $5_1;
     $4_1 = $5_1;
    }
    block6 : {
     $5_1 = $29(65820 | 0) | 0;
     if (!$5_1) {
      break block6
     }
     $5_1 = $30($5_1 | 0) | 0;
     if ($5_1 >>> 0 > 1 >>> 0) {
      break block6
     }
     $4_1 = $4_1 | ($5_1 << 2 | 0) | 0;
     HEAP32[($3_1 + 108 | 0) >> 2] = $4_1;
    }
    block7 : {
     $5_1 = $29(65767 | 0) | 0;
     if (!$5_1) {
      break block7
     }
     $5_1 = $30($5_1 | 0) | 0;
     if ($5_1 >>> 0 > 1 >>> 0) {
      break block7
     }
     HEAP32[($3_1 + 108 | 0) >> 2] = $4_1 & -9 | 0 | ($5_1 << 3 | 0) | 0;
    }
    HEAPF64[($3_1 + 72 | 0) >> 3] = +Math_fround(Math_fround(HEAPF32[((((HEAP32[($3_1 + 68 | 0) >> 2] | 0) & 3 | 0) << 2 | 0) + 65536 | 0) >> 2]) / Math_fround(HEAPF32[((((HEAP32[($3_1 + 64 | 0) >> 2] | 0) & 3 | 0) << 2 | 0) + 65536 | 0) >> 2]));
    $4_1 = global$0 - 16 | 0;
    global$0 = $4_1;
    i64toi32_i32$1 = $4_1;
    i64toi32_i32$0 = 0;
    HEAP32[(i64toi32_i32$1 + 8 | 0) >> 2] = 0;
    HEAP32[(i64toi32_i32$1 + 12 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$0 = 0;
    legalfunc$fimport$2(0 | 0, 1e9 | 0, i64toi32_i32$0 | 0, i64toi32_i32$1 + 8 | 0 | 0) | 0;
    i64toi32_i32$2 = i64toi32_i32$1;
    i64toi32_i32$0 = HEAP32[(i64toi32_i32$1 + 8 | 0) >> 2] | 0;
    i64toi32_i32$1 = HEAP32[(i64toi32_i32$1 + 12 | 0) >> 2] | 0;
    $123$hi = i64toi32_i32$1;
    global$0 = $4_1 + 16 | 0;
    i64toi32_i32$1 = 0;
    $127$hi = i64toi32_i32$1;
    i64toi32_i32$1 = $123$hi;
    $18_1 = i64toi32_i32$0;
    i64toi32_i32$0 = $127$hi;
    i64toi32_i32$0 = __wasm_i64_udiv($18_1 | 0, i64toi32_i32$1 | 0, 1e9 | 0, i64toi32_i32$0 | 0) | 0;
    i64toi32_i32$1 = i64toi32_i32$HIGH_BITS;
    $6_1 = i64toi32_i32$0;
    $6$hi = i64toi32_i32$1;
    HEAP32[($3_1 + 176 | 0) >> 2] = 1;
    HEAP32[($3_1 + 172 | 0) >> 2] = 2;
    i64toi32_i32$2 = 65904;
    i64toi32_i32$1 = HEAP32[i64toi32_i32$2 >> 2] | 0;
    i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
    $132 = i64toi32_i32$1;
    i64toi32_i32$1 = $3_1;
    HEAP32[(i64toi32_i32$1 + 132 | 0) >> 2] = $132;
    HEAP32[(i64toi32_i32$1 + 136 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$2 = 65912;
    i64toi32_i32$0 = HEAP32[i64toi32_i32$2 >> 2] | 0;
    i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
    $134 = i64toi32_i32$0;
    i64toi32_i32$0 = $3_1;
    HEAP32[(i64toi32_i32$0 + 140 | 0) >> 2] = $134;
    HEAP32[(i64toi32_i32$0 + 144 | 0) >> 2] = i64toi32_i32$1;
    i64toi32_i32$2 = 65920;
    i64toi32_i32$1 = HEAP32[i64toi32_i32$2 >> 2] | 0;
    i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
    $136 = i64toi32_i32$1;
    i64toi32_i32$1 = $3_1;
    HEAP32[(i64toi32_i32$1 + 148 | 0) >> 2] = $136;
    HEAP32[(i64toi32_i32$1 + 152 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$2 = 65928;
    i64toi32_i32$0 = HEAP32[i64toi32_i32$2 >> 2] | 0;
    i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
    $138 = i64toi32_i32$0;
    i64toi32_i32$0 = $3_1;
    HEAP32[(i64toi32_i32$0 + 156 | 0) >> 2] = $138;
    HEAP32[(i64toi32_i32$0 + 160 | 0) >> 2] = i64toi32_i32$1;
    i64toi32_i32$2 = 65936;
    i64toi32_i32$1 = HEAP32[i64toi32_i32$2 >> 2] | 0;
    i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
    $140 = i64toi32_i32$1;
    i64toi32_i32$1 = $3_1;
    HEAP32[(i64toi32_i32$1 + 164 | 0) >> 2] = $140;
    HEAP32[(i64toi32_i32$1 + 168 | 0) >> 2] = i64toi32_i32$0;
    i64toi32_i32$0 = $6$hi;
    HEAP32[(i64toi32_i32$1 + 188 | 0) >> 2] = $6_1 ^ i64toi32_i32$1 | 0;
    block8 : {
     if (!$2_1) {
      break block8
     }
     if (!($1(i64toi32_i32$1 | 0, +$0_1, 0 | 0) | 0)) {
      break block8
     }
     $4_1 = i64toi32_i32$1;
     break block;
    }
    $4_1 = $3_1;
    if (!($1($4_1 | 0, +$1_1, 0 | 0) | 0)) {
     break block9
    }
   }
   $4($4_1 | 0);
   $3_1 = 0;
  }
  return $3_1 | 0;
 }
 
 function $29($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0, $2_1 = 0, $3_1 = 0, $4_1 = 0, $5_1 = 0, $6_1 = 0, $9_1 = 0, $7_1 = 0, $168 = 0, $11_1 = 0, $8_1 = 0, $10_1 = 0;
  $5_1 = global$0 - 16 | 0;
  global$0 = $5_1;
  $4_1 = HEAP32[73696 >> 2] | 0;
  if (($4_1 | 0) == (-1 | 0)) {
   block : {
    block1 : {
     block2 : {
      if (!((fimport$1($5_1 + 12 | 0 | 0, $5_1 + 8 | 0 | 0) | 0) & 65535 | 0)) {
       $1_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
       if (!$1_1) {
        $4_1 = 290840;
        break block;
       }
       $2_1 = $1_1 + 1 | 0;
       if (!$2_1) {
        break block1
       }
       $1_1 = $36(HEAP32[($5_1 + 8 | 0) >> 2] | 0 | 0) | 0;
       if (!$1_1) {
        break block1
       }
       $2_1 = $2_1 >>> 0 > 1073741823 >>> 0 ? -1 : $2_1 << 2 | 0;
       $4_1 = $36($2_1 | 0) | 0;
       if (!$4_1) {
        break block2
       }
       block3 : {
        if (!((HEAPU8[($4_1 - 4 | 0) >> 0] | 0) & 3 | 0)) {
         break block3
        }
        if (!$2_1) {
         break block3
        }
        $42($4_1 | 0, $2_1 | 0);
       }
       if (!((fimport$0($4_1 | 0, $1_1 | 0) | 0) & 65535 | 0)) {
        break block
       }
       $37($1_1 | 0);
       $37($4_1 | 0);
      }
      $38(71 | 0);
      wasm2js_trap();
     }
     $37($1_1 | 0);
    }
    $38(70 | 0);
    wasm2js_trap();
   }
   HEAP32[73696 >> 2] = $4_1;
  }
  block5 : {
   block6 : {
    block4 : {
     $1_1 = $0_1;
     if (!($1_1 & 3 | 0)) {
      break block4
     }
     $2_1 = HEAPU8[$1_1 >> 0] | 0;
     if (!$2_1) {
      break block5
     }
     if (($2_1 | 0) == (61 | 0)) {
      break block5
     }
     $1_1 = $1_1 + 1 | 0;
     if (!($1_1 & 3 | 0)) {
      break block4
     }
     $2_1 = HEAPU8[$1_1 >> 0] | 0;
     if (!$2_1) {
      break block6
     }
     if (($2_1 | 0) == (61 | 0)) {
      break block6
     }
     $1_1 = $0_1 + 2 | 0;
     if (!($1_1 & 3 | 0)) {
      break block4
     }
     $2_1 = HEAPU8[$1_1 >> 0] | 0;
     if (!$2_1) {
      break block6
     }
     if (($2_1 | 0) == (61 | 0)) {
      break block6
     }
     $1_1 = $0_1 + 3 | 0;
     if (!($1_1 & 3 | 0)) {
      break block4
     }
     $2_1 = HEAPU8[$1_1 >> 0] | 0;
     if (!$2_1) {
      break block6
     }
     if (($2_1 | 0) == (61 | 0)) {
      break block6
     }
     $1_1 = $0_1 + 4 | 0;
    }
    block7 : {
     $3_1 = HEAP32[$1_1 >> 2] | 0;
     if (((16843008 - $3_1 | 0 | $3_1 | 0) & -2139062144 | 0 | 0) != (-2139062144 | 0)) {
      break block7
     }
     label : while (1) {
      if (((16843008 - ($3_1 ^ 1027423549 | 0) | 0 | $3_1 | 0) & -2139062144 | 0 | 0) != (-2139062144 | 0)) {
       break block7
      }
      $1_1 = $1_1 + 4 | 0;
      $3_1 = HEAP32[$1_1 >> 2] | 0;
      if (((16843008 - $3_1 | 0 | $3_1 | 0) & -2139062144 | 0 | 0) == (-2139062144 | 0)) {
       continue label
      }
      break label;
     };
    }
    $1_1 = $1_1 - 1 | 0;
    label1 : while (1) {
     $1_1 = $1_1 + 1 | 0;
     $2_1 = HEAPU8[$1_1 >> 0] | 0;
     if (($2_1 | 0) != (61 | 0)) {
      if ($2_1) {
       continue label1
      }
     }
     break label1;
    };
    if (($0_1 | 0) != ($1_1 | 0)) {
     break block6
    }
    $3_1 = 0;
    break block5;
   }
   $3_1 = 0;
   if (HEAPU8[$1_1 >> 0] | 0) {
    break block5
   }
   if (!$4_1) {
    break block5
   }
   $2_1 = HEAP32[$4_1 >> 2] | 0;
   if (!$2_1) {
    break block5
   }
   $8_1 = $1_1 - $0_1 | 0;
   $9_1 = $0_1 + 1 | 0;
   $10_1 = $9_1 - $1_1 | 0;
   $7_1 = HEAPU8[$0_1 >> 0] | 0;
   block10 : {
    label3 : while (1) {
     block8 : {
      if (!$7_1) {
       $1_1 = $2_1;
       $168 = 0;
       break block8;
      }
      $6_1 = $9_1;
      $0_1 = $10_1;
      $3_1 = $7_1;
      $1_1 = $2_1;
      block9 : {
       label2 : while (1) {
        $11_1 = HEAPU8[$1_1 >> 0] | 0;
        if (($11_1 | 0) != ($3_1 & 255 | 0 | 0)) {
         break block9
        }
        if (!$11_1) {
         break block9
        }
        if (!$0_1) {
         break block9
        }
        $0_1 = $0_1 + 1 | 0;
        $1_1 = $1_1 + 1 | 0;
        $3_1 = HEAPU8[$6_1 >> 0] | 0;
        $6_1 = $6_1 + 1 | 0;
        if ($3_1) {
         continue label2
        }
        break label2;
       };
       $3_1 = 0;
      }
      $168 = $3_1 & 255 | 0;
     }
     if (($168 | 0) == (HEAPU8[$1_1 >> 0] | 0 | 0)) {
      $0_1 = $2_1 + $8_1 | 0;
      if ((HEAPU8[$0_1 >> 0] | 0 | 0) == (61 | 0)) {
       break block10
      }
     }
     $2_1 = HEAP32[($4_1 + 4 | 0) >> 2] | 0;
     $4_1 = $4_1 + 4 | 0;
     if ($2_1) {
      continue label3
     }
     break label3;
    };
    $3_1 = 0;
    break block5;
   }
   $3_1 = $0_1 + 1 | 0;
  }
  global$0 = $5_1 + 16 | 0;
  return $3_1 | 0;
 }
 
 function $30($0_1) {
  $0_1 = $0_1 | 0;
  var $2_1 = 0, $1_1 = 0, $3_1 = 0, $4_1 = 0, $11_1 = 0, $35_1 = 0;
  label : while (1) {
   $3_1 = $0_1;
   $0_1 = $0_1 + 1 | 0;
   $2_1 = HEAP8[$3_1 >> 0] | 0;
   $11_1 = $2_1 - 14 | 0;
   $1_1 = $2_1 & 255 | 0;
   if (($1_1 | 0) == (32 | 0)) {
    continue label
   }
   if ($11_1 >>> 0 > -6 >>> 0) {
    continue label
   }
   break label;
  };
  $4_1 = 1;
  block1 : {
   switch ($1_1 - 43 | 0 | 0) {
   case 2:
    $4_1 = 0;
   case 0:
    $2_1 = HEAP8[$0_1 >> 0] | 0;
    $3_1 = $0_1;
    break;
   default:
    break block1;
   };
  }
  $1_1 = 0;
  $2_1 = $2_1 - 48 | 0;
  if ($2_1 >>> 0 <= 9 >>> 0) {
   $0_1 = $3_1 + 1 | 0;
   label1 : while (1) {
    $1_1 = Math_imul($1_1, 10) - $2_1 | 0;
    $35_1 = HEAP8[$0_1 >> 0] | 0;
    $0_1 = $0_1 + 1 | 0;
    $2_1 = $35_1 - 48 | 0;
    if ($2_1 >>> 0 < 10 >>> 0) {
     continue label1
    }
    break label1;
   };
  }
  return ($4_1 ? 0 - $1_1 | 0 : $1_1) | 0;
 }
 
 function $31($2_1, $3_1, $4_1, $5_1, $6_1) {
  $2_1 = $2_1 | 0;
  $3_1 = $3_1 | 0;
  $4_1 = $4_1 | 0;
  $5_1 = $5_1 | 0;
  $6_1 = $6_1 | 0;
  var $7_1 = 0, $8_1 = 0, $10_1 = 0, $16_1 = 0.0, $9_1 = 0, $11_1 = 0, $17_1 = 0.0, $179 = 0, $48 = 0, $211 = 0, $13_1 = 0, $12_1 = 0, $15_1 = 0, $422 = 0, $23_1 = 0, $25_1 = 0, $27_1 = 0, $32_1 = 0, $199 = 0, $14_1 = 0, scratch = 0;
  $7_1 = global$0 - 32 | 0;
  global$0 = $7_1;
  HEAP32[290836 >> 2] = 0;
  HEAP32[290832 >> 2] = 0;
  if ($2_1) {
   block2 : {
    block4 : {
     block3 : {
      block : {
       block1 : {
        if ($3_1) {
         $23_1 = $2_1;
         $25_1 = HEAP32[($2_1 + 192 | 0) >> 2] | 0;
         $27_1 = ($4_1 | 0) < (0 | 0);
         $4_1 = ($4_1 >> 31 | 0) ^ $4_1 | 0;
         $32_1 = $4_1;
         $16_1 = +($6_1 >>> 0);
         $17_1 = Math_ceil(+HEAPF64[($2_1 + 8 | 0) >> 3] * $16_1);
         if ($17_1 < 4294967295.0 & $17_1 >= 0.0 | 0) {
          $48 = ~~$17_1 >>> 0
         } else {
          $48 = 0
         }
         $8_1 = $48;
         HEAP32[($23_1 + 192 | 0) >> 2] = $25_1 | ($27_1 & $32_1 >>> 0 <= $8_1 >>> 0 | 0) | 0;
         $11_1 = $4_1 >>> 0 < $8_1 >>> 0 ? $4_1 : $8_1;
         if (!(((HEAP32[($2_1 + 64 | 0) >> 2] | 0) & (HEAP32[($2_1 + 68 | 0) >> 2] | 0) | 0) & 4 | 0)) {
          break block
         }
         break block1;
        }
        HEAP32[($2_1 + 192 | 0) >> 2] = HEAP32[($2_1 + 192 | 0) >> 2] | 0 | 1 | 0;
        if (!$5_1) {
         break block2
        }
        if (!(((HEAP32[($2_1 + 64 | 0) >> 2] | 0) & (HEAP32[($2_1 + 68 | 0) >> 2] | 0) | 0) & 4 | 0)) {
         break block3
        }
       }
       $10_1 = $2_1 + 192 | 0;
       if (!(HEAP32[$2_1 >> 2] | 0)) {
        break block2
       }
       $9_1 = $2_1 + 188 | 0;
       $4_1 = 0;
       $8_1 = 0;
       label : while (1) {
        if ($3_1) {
         HEAP32[($7_1 + 28 | 0) >> 2] = HEAP32[($3_1 + $4_1 | 0) >> 2] | 0;
         HEAP32[($7_1 + 24 | 0) >> 2] = FUNCTION_TABLE[HEAP32[($2_1 + 132 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0, 0, $11_1) | 0;
         FUNCTION_TABLE[HEAP32[($2_1 + 172 | 0) >> 2] | 0 | 0]($7_1 + 24 | 0, HEAP32[($2_1 + 64 | 0) >> 2] | 0, $7_1 + 28 | 0, $11_1, 1);
        }
        HEAP32[($7_1 + 28 | 0) >> 2] = HEAP32[($4_1 + $5_1 | 0) >> 2] | 0;
        HEAP32[($7_1 + 24 | 0) >> 2] = $6_1;
        if (HEAP32[$10_1 >> 2] | 0) {
         FUNCTION_TABLE[HEAP32[($2_1 + 144 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0)
        }
        FUNCTION_TABLE[HEAP32[($2_1 + 136 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0, $6_1);
        HEAP32[($7_1 + 20 | 0) >> 2] = FUNCTION_TABLE[HEAP32[($2_1 + 140 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0, 0, $7_1 + 24 | 0) | 0;
        HEAP32[($2_1 + 184 | 0) >> 2] = (FUNCTION_TABLE[HEAP32[($2_1 + 176 | 0) >> 2] | 0 | 0](HEAP32[($2_1 + 68 | 0) >> 2] | 0, $7_1 + 28 | 0, $7_1 + 20 | 0, HEAP32[($7_1 + 24 | 0) >> 2] | 0, 1, (HEAP32[($2_1 + 84 | 0) >> 2] | 0) & 8 | 0 ? 0 : $9_1) | 0) + (HEAP32[($2_1 + 184 | 0) >> 2] | 0) | 0;
        $4_1 = $4_1 + 4 | 0;
        $8_1 = $8_1 + 1 | 0;
        if ($8_1 >>> 0 < (HEAP32[$2_1 >> 2] | 0) >>> 0) {
         continue label
        }
        break label;
       };
       $9_1 = HEAP32[($7_1 + 24 | 0) >> 2] | 0;
       break block2;
      }
      $179 = 0;
      if (!$11_1) {
       break block4
      }
      $179 = $5($2_1 | 0, $3_1 | 0, $11_1 | 0) | 0;
      break block4;
     }
     $16_1 = +($6_1 >>> 0);
     $179 = 0;
    }
    $11_1 = $179;
    $3_1 = HEAP32[($2_1 + 120 | 0) >> 2] | 0;
    $17_1 = +HEAPF64[($2_1 + 8 | 0) >> 3];
    HEAP32[($7_1 + 12 | 0) >> 2] = $5_1;
    if (HEAP32[($2_1 + 16 | 0) >> 2] | 0) {
     break block2
    }
    if ($6_1 ? $5_1 : 1) {
     $199 = $3_1;
     $16_1 = Math_ceil($17_1 * $16_1);
     if ($16_1 < 4294967295.0 & $16_1 >= 0.0 | 0) {
      $211 = ~~$16_1 >>> 0
     } else {
      $211 = 0
     }
     $4_1 = $211;
     $14_1 = $3_1 >>> 0 < $4_1 >>> 0 ? $199 : $4_1;
     $13_1 = $2_1 + 188 | 0;
     $8_1 = $6_1;
     label3 : while (1) {
      HEAP32[($7_1 + 16 | 0) >> 2] = $5_1;
      $12_1 = (HEAP32[($2_1 + 68 | 0) >> 2] | 0) & 4 | 0;
      $4_1 = 0;
      $3_1 = 0;
      if (HEAP32[$2_1 >> 2] | 0) {
       block5 : {
        if ($12_1) {
         $10_1 = 0;
         label1 : while (1) {
          HEAP32[($7_1 + 28 | 0) >> 2] = HEAP32[($4_1 + $5_1 | 0) >> 2] | 0;
          HEAP32[($7_1 + 24 | 0) >> 2] = $8_1;
          if (HEAP32[($2_1 + 192 | 0) >> 2] | 0) {
           FUNCTION_TABLE[HEAP32[($2_1 + 144 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0)
          }
          FUNCTION_TABLE[HEAP32[($2_1 + 136 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0, $8_1);
          HEAP32[($7_1 + 20 | 0) >> 2] = FUNCTION_TABLE[HEAP32[($2_1 + 140 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0, 0, $7_1 + 24 | 0) | 0;
          HEAP32[($2_1 + 184 | 0) >> 2] = (FUNCTION_TABLE[HEAP32[($2_1 + 176 | 0) >> 2] | 0 | 0](HEAP32[($2_1 + 68 | 0) >> 2] | 0, $7_1 + 28 | 0, $7_1 + 20 | 0, HEAP32[($7_1 + 24 | 0) >> 2] | 0, 1, (HEAP32[($2_1 + 84 | 0) >> 2] | 0) & 8 | 0 ? 0 : $13_1) | 0) + (HEAP32[($2_1 + 184 | 0) >> 2] | 0) | 0;
          $4_1 = $4_1 + 4 | 0;
          $10_1 = $10_1 + 1 | 0;
          $3_1 = HEAP32[$2_1 >> 2] | 0;
          if ($10_1 >>> 0 < $3_1 >>> 0) {
           continue label1
          }
          break label1;
         };
         break block5;
        }
        $10_1 = 0;
        label2 : while (1) {
         HEAP32[($7_1 + 24 | 0) >> 2] = $8_1;
         if (HEAP32[($2_1 + 192 | 0) >> 2] | 0) {
          FUNCTION_TABLE[HEAP32[($2_1 + 144 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0)
         }
         FUNCTION_TABLE[HEAP32[($2_1 + 136 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0, $8_1);
         $3_1 = FUNCTION_TABLE[HEAP32[($2_1 + 140 | 0) >> 2] | 0 | 0](HEAP32[((HEAP32[($2_1 + 128 | 0) >> 2] | 0) + $4_1 | 0) >> 2] | 0, 0, $7_1 + 24 | 0) | 0;
         HEAP32[((HEAP32[($2_1 + 180 | 0) >> 2] | 0) + $4_1 | 0) >> 2] = $3_1;
         $4_1 = $4_1 + 4 | 0;
         $10_1 = $10_1 + 1 | 0;
         $3_1 = HEAP32[$2_1 >> 2] | 0;
         if ($10_1 >>> 0 < $3_1 >>> 0) {
          continue label2
         }
         break label2;
        };
       }
       $4_1 = HEAP32[($7_1 + 24 | 0) >> 2] | 0;
      }
      if (!$12_1) {
       HEAP32[($2_1 + 184 | 0) >> 2] = (FUNCTION_TABLE[HEAP32[($2_1 + 176 | 0) >> 2] | 0 | 0](HEAP32[($2_1 + 68 | 0) >> 2] | 0, $7_1 + 16 | 0, HEAP32[($2_1 + 180 | 0) >> 2] | 0, $4_1, $3_1, (HEAP32[($2_1 + 84 | 0) >> 2] | 0) & 8 | 0 ? 0 : $13_1) | 0) + (HEAP32[($2_1 + 184 | 0) >> 2] | 0) | 0
      }
      $9_1 = $4_1 + $9_1 | 0;
      if (($6_1 | 0) == ($9_1 | 0)) {
       $9_1 = $6_1;
       break block2;
      }
      $3_1 = HEAP32[($2_1 + 116 | 0) >> 2] | 0;
      if (!$3_1) {
       break block2
      }
      if (HEAP32[($2_1 + 192 | 0) >> 2] | 0) {
       break block2
      }
      $10_1 = Math_imul(HEAP32[$2_1 >> 2] | 0, Math_imul($4_1, HEAPU8[(((HEAP32[($2_1 + 68 | 0) >> 2] | 0) & 3 | 0) + 65895 | 0) >> 0] | 0));
      $3_1 = FUNCTION_TABLE[$3_1 | 0](HEAP32[($2_1 + 112 | 0) >> 2] | 0, $7_1 + 12 | 0, $14_1) | 0;
      scratch = HEAP32[($2_1 + 192 | 0) >> 2] | 0;
      block6 : {
       $15_1 = HEAP32[($7_1 + 12 | 0) >> 2] | 0;
       if (!$15_1) {
        HEAP32[($2_1 + 16 | 0) >> 2] = 65698;
        break block6;
       }
       $5($2_1 | 0, $15_1 | 0, $3_1 | 0) | 0;
      }
      $8_1 = $8_1 - $4_1 | 0;
      $5_1 = $5_1 + $10_1 | 0;
      if ($3_1 | $4_1 | 0) {
       continue label3
      }
      if (scratch) {
       break block2
      }
      if (HEAP32[($2_1 + 192 | 0) >> 2] | 0) {
       continue label3
      }
      break label3;
     };
     break block2;
    }
    HEAP32[($2_1 + 16 | 0) >> 2] = 65575;
   }
   HEAP32[290832 >> 2] = $9_1;
   HEAP32[290836 >> 2] = $11_1;
   $422 = (HEAP32[($2_1 + 16 | 0) >> 2] | 0 | 0) != (0 | 0);
  } else {
   $422 = 1
  }
  global$0 = $7_1 + 32 | 0;
  return $422 | 0;
 }
 
 function $32() {
  return HEAP32[290836 >> 2] | 0 | 0;
 }
 
 function $33() {
  return HEAP32[290832 >> 2] | 0 | 0;
 }
 
 function $34($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = +$1_1;
  $2_1 = $2_1 | 0;
  return ($1($0_1 | 0, +$1_1, $2_1 | 0) | 0 | 0) != (0 | 0) | 0;
 }
 
 function $35($0_1) {
  $0_1 = $0_1 | 0;
  $4($0_1 | 0);
 }
 
 function $36($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0, $4_1 = 0, $2_1 = 0, $3_1 = 0, $5_1 = 0, $6_1 = 0, $7_1 = 0, $8_1 = 0, $9_1 = 0, i64toi32_i32$0 = 0, i64toi32_i32$1 = 0, $10_1 = 0, i64toi32_i32$2 = 0, $11_1 = 0, $846 = 0, $149 = 0, $229 = 0, $356 = 0, $392 = 0, $469 = 0, $838 = 0, $1051 = 0, $1146 = 0, $1336 = 0, $1523 = 0, $191 = 0, $466 = 0, $791 = 0, $793 = 0;
  $11_1 = global$0 - 16 | 0;
  global$0 = $11_1;
  $6_1 = HEAP32[290868 >> 2] | 0;
  if (!$6_1) {
   $3_1 = HEAP32[291316 >> 2] | 0;
   if (!$3_1) {
    HEAP32[291324 >> 2] = 65536;
    i64toi32_i32$1 = 291328;
    i64toi32_i32$0 = -1;
    HEAP32[i64toi32_i32$1 >> 2] = -1;
    HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
    HEAP32[291320 >> 2] = 65536;
    $3_1 = (($11_1 + 8 | 0) & -16 | 0) ^ 1431655768 | 0;
    HEAP32[291316 >> 2] = $3_1;
    HEAP32[291336 >> 2] = 0;
    HEAP32[291288 >> 2] = 0;
   }
   HEAP32[291292 >> 2] = 291344;
   HEAP32[290860 >> 2] = 291344;
   HEAP32[290880 >> 2] = $3_1;
   HEAP32[290896 >> 2] = 290884;
   HEAP32[290876 >> 2] = -1;
   HEAP32[290904 >> 2] = 290892;
   HEAP32[290892 >> 2] = 290884;
   HEAP32[290912 >> 2] = 290900;
   HEAP32[290900 >> 2] = 290892;
   HEAP32[290920 >> 2] = 290908;
   HEAP32[290908 >> 2] = 290900;
   HEAP32[290928 >> 2] = 290916;
   HEAP32[290916 >> 2] = 290908;
   HEAP32[290936 >> 2] = 290924;
   HEAP32[290924 >> 2] = 290916;
   HEAP32[290944 >> 2] = 290932;
   HEAP32[290932 >> 2] = 290924;
   HEAP32[291296 >> 2] = 16485872;
   HEAP32[291280 >> 2] = 16485872;
   HEAP32[291276 >> 2] = 16485872;
   HEAP32[290952 >> 2] = 290940;
   HEAP32[290940 >> 2] = 290932;
   HEAP32[290948 >> 2] = 290940;
   HEAP32[290960 >> 2] = 290948;
   HEAP32[290956 >> 2] = 290948;
   HEAP32[290968 >> 2] = 290956;
   HEAP32[290964 >> 2] = 290956;
   HEAP32[290976 >> 2] = 290964;
   HEAP32[290972 >> 2] = 290964;
   HEAP32[290984 >> 2] = 290972;
   HEAP32[290980 >> 2] = 290972;
   HEAP32[290992 >> 2] = 290980;
   HEAP32[290988 >> 2] = 290980;
   HEAP32[291e3 >> 2] = 290988;
   HEAP32[290996 >> 2] = 290988;
   HEAP32[291008 >> 2] = 290996;
   HEAP32[291004 >> 2] = 290996;
   HEAP32[291016 >> 2] = 291004;
   HEAP32[291024 >> 2] = 291012;
   HEAP32[291012 >> 2] = 291004;
   HEAP32[291032 >> 2] = 291020;
   HEAP32[291020 >> 2] = 291012;
   HEAP32[291040 >> 2] = 291028;
   HEAP32[291028 >> 2] = 291020;
   HEAP32[291048 >> 2] = 291036;
   HEAP32[291036 >> 2] = 291028;
   HEAP32[291056 >> 2] = 291044;
   HEAP32[291044 >> 2] = 291036;
   HEAP32[291064 >> 2] = 291052;
   HEAP32[291052 >> 2] = 291044;
   HEAP32[291072 >> 2] = 291060;
   HEAP32[291060 >> 2] = 291052;
   HEAP32[291080 >> 2] = 291068;
   HEAP32[291068 >> 2] = 291060;
   HEAP32[291088 >> 2] = 291076;
   HEAP32[291076 >> 2] = 291068;
   HEAP32[291096 >> 2] = 291084;
   HEAP32[291084 >> 2] = 291076;
   HEAP32[291104 >> 2] = 291092;
   HEAP32[291092 >> 2] = 291084;
   HEAP32[291112 >> 2] = 291100;
   HEAP32[291100 >> 2] = 291092;
   HEAP32[291120 >> 2] = 291108;
   HEAP32[291108 >> 2] = 291100;
   HEAP32[291128 >> 2] = 291116;
   HEAP32[291116 >> 2] = 291108;
   HEAP32[291136 >> 2] = 291124;
   HEAP32[291124 >> 2] = 291116;
   HEAP32[291144 >> 2] = 291132;
   HEAP32[291132 >> 2] = 291124;
   HEAP32[291140 >> 2] = 291132;
   $6_1 = 291352;
   HEAP32[290868 >> 2] = $6_1;
   HEAP32[290856 >> 2] = 16485808;
   HEAP32[291356 >> 2] = 16485809;
   HEAP32[16777164 >> 2] = 56;
   HEAP32[290872 >> 2] = HEAP32[291332 >> 2] | 0;
  }
  block1 : {
   block6 : {
    block12 : {
     block27 : {
      block25 : {
       block24 : {
        block22 : {
         block19 : {
          block16 : {
           block18 : {
            block20 : {
             block13 : {
              block7 : {
               block2 : {
                if ($0_1 >>> 0 <= 236 >>> 0) {
                 $5_1 = HEAP32[290844 >> 2] | 0;
                 $7_1 = $0_1 >>> 0 < 11 >>> 0 ? 16 : ($0_1 + 19 | 0) & 496 | 0;
                 $0_1 = $7_1 >>> 3 | 0;
                 $1_1 = $5_1 >>> $0_1 | 0;
                 if ($1_1 & 3 | 0) {
                  block : {
                   $3_1 = ($1_1 & 1 | 0 | $0_1 | 0) ^ 1 | 0;
                   $1_1 = $3_1 << 3 | 0;
                   $0_1 = $1_1 + 290884 | 0;
                   $4_1 = HEAP32[($1_1 + 290892 | 0) >> 2] | 0;
                   $2_1 = HEAP32[($4_1 + 8 | 0) >> 2] | 0;
                   if (($0_1 | 0) == ($2_1 | 0)) {
                    HEAP32[290844 >> 2] = $5_1 & (__wasm_rotl_i32(-2 | 0, $3_1 | 0) | 0) | 0;
                    break block;
                   }
                   HEAP32[($0_1 + 8 | 0) >> 2] = $2_1;
                   HEAP32[($2_1 + 12 | 0) >> 2] = $0_1;
                  }
                  $0_1 = $4_1 + 8 | 0;
                  HEAP32[($4_1 + 4 | 0) >> 2] = $1_1 | 3 | 0;
                  $1_1 = $1_1 + $4_1 | 0;
                  HEAP32[($1_1 + 4 | 0) >> 2] = HEAP32[($1_1 + 4 | 0) >> 2] | 0 | 1 | 0;
                  break block1;
                 }
                 $8_1 = HEAP32[290852 >> 2] | 0;
                 if ($7_1 >>> 0 <= $8_1 >>> 0) {
                  break block2
                 }
                 if ($1_1) {
                  block3 : {
                   $4_1 = 2 << $0_1 | 0;
                   $3_1 = __wasm_ctz_i32(($4_1 | (0 - $4_1 | 0) | 0) & ($1_1 << $0_1 | 0) | 0 | 0) | 0;
                   $1_1 = $3_1 << 3 | 0;
                   $4_1 = $1_1 + 290884 | 0;
                   $0_1 = HEAP32[($1_1 + 290892 | 0) >> 2] | 0;
                   $2_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
                   if (($4_1 | 0) == ($2_1 | 0)) {
                    $5_1 = $5_1 & (__wasm_rotl_i32(-2 | 0, $3_1 | 0) | 0) | 0;
                    HEAP32[290844 >> 2] = $5_1;
                    break block3;
                   }
                   HEAP32[($4_1 + 8 | 0) >> 2] = $2_1;
                   HEAP32[($2_1 + 12 | 0) >> 2] = $4_1;
                  }
                  HEAP32[($0_1 + 4 | 0) >> 2] = $7_1 | 3 | 0;
                  $2_1 = $1_1 - $7_1 | 0;
                  HEAP32[($0_1 + $1_1 | 0) >> 2] = $2_1;
                  $3_1 = $0_1 + $7_1 | 0;
                  HEAP32[($3_1 + 4 | 0) >> 2] = $2_1 | 1 | 0;
                  if ($8_1) {
                   $1_1 = ($8_1 & -8 | 0) + 290884 | 0;
                   $4_1 = HEAP32[290864 >> 2] | 0;
                   block4 : {
                    $6_1 = 1 << ($8_1 >>> 3 | 0) | 0;
                    if (!($5_1 & $6_1 | 0)) {
                     HEAP32[290844 >> 2] = $5_1 | $6_1 | 0;
                     $149 = $1_1;
                     break block4;
                    }
                    $149 = HEAP32[($1_1 + 8 | 0) >> 2] | 0;
                   }
                   $5_1 = $149;
                   HEAP32[($5_1 + 12 | 0) >> 2] = $4_1;
                   HEAP32[($1_1 + 8 | 0) >> 2] = $4_1;
                   HEAP32[($4_1 + 12 | 0) >> 2] = $1_1;
                   HEAP32[($4_1 + 8 | 0) >> 2] = $5_1;
                  }
                  $0_1 = $0_1 + 8 | 0;
                  HEAP32[290864 >> 2] = $3_1;
                  HEAP32[290852 >> 2] = $2_1;
                  break block1;
                 }
                 $10_1 = HEAP32[290848 >> 2] | 0;
                 if (!$10_1) {
                  break block2
                 }
                 $1_1 = HEAP32[(((__wasm_ctz_i32($10_1 | 0) | 0) << 2 | 0) + 291148 | 0) >> 2] | 0;
                 $3_1 = ((HEAP32[($1_1 + 4 | 0) >> 2] | 0) & -8 | 0) - $7_1 | 0;
                 $2_1 = $1_1;
                 label : while (1) {
                  block5 : {
                   $0_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
                   if (!$0_1) {
                    $0_1 = HEAP32[($1_1 + 20 | 0) >> 2] | 0;
                    if (!$0_1) {
                     break block5
                    }
                   }
                   $1_1 = ((HEAP32[($0_1 + 4 | 0) >> 2] | 0) & -8 | 0) - $7_1 | 0;
                   $191 = $1_1;
                   $1_1 = $1_1 >>> 0 < $3_1 >>> 0;
                   $3_1 = $1_1 ? $191 : $3_1;
                   $2_1 = $1_1 ? $0_1 : $2_1;
                   $1_1 = $0_1;
                   continue label;
                  }
                  break label;
                 };
                 $9_1 = HEAP32[($2_1 + 24 | 0) >> 2] | 0;
                 $0_1 = HEAP32[($2_1 + 12 | 0) >> 2] | 0;
                 if (($2_1 | 0) != ($0_1 | 0)) {
                  $1_1 = HEAP32[($2_1 + 8 | 0) >> 2] | 0;
                  HEAP32[($1_1 + 12 | 0) >> 2] = $0_1;
                  HEAP32[($0_1 + 8 | 0) >> 2] = $1_1;
                  break block6;
                 }
                 $1_1 = HEAP32[($2_1 + 20 | 0) >> 2] | 0;
                 if ($1_1) {
                  $229 = $2_1 + 20 | 0
                 } else {
                  $1_1 = HEAP32[($2_1 + 16 | 0) >> 2] | 0;
                  if (!$1_1) {
                   break block7
                  }
                  $229 = $2_1 + 16 | 0;
                 }
                 $4_1 = $229;
                 label1 : while (1) {
                  $6_1 = $4_1;
                  $0_1 = $1_1;
                  $4_1 = $0_1 + 20 | 0;
                  $1_1 = HEAP32[($0_1 + 20 | 0) >> 2] | 0;
                  if ($1_1) {
                   continue label1
                  }
                  $4_1 = $0_1 + 16 | 0;
                  $1_1 = HEAP32[($0_1 + 16 | 0) >> 2] | 0;
                  if ($1_1) {
                   continue label1
                  }
                  break label1;
                 };
                 HEAP32[$6_1 >> 2] = 0;
                 break block6;
                }
                $7_1 = -1;
                if ($0_1 >>> 0 > -65 >>> 0) {
                 break block2
                }
                $1_1 = $0_1 + 19 | 0;
                $7_1 = $1_1 & -16 | 0;
                $8_1 = HEAP32[290848 >> 2] | 0;
                if (!$8_1) {
                 break block2
                }
                $9_1 = 31;
                $3_1 = 0 - $7_1 | 0;
                if ($0_1 >>> 0 <= 16777196 >>> 0) {
                 $0_1 = Math_clz32($1_1 >>> 8 | 0);
                 $9_1 = ((($7_1 >>> (38 - $0_1 | 0) | 0) & 1 | 0) - ($0_1 << 1 | 0) | 0) + 62 | 0;
                }
                block11 : {
                 block10 : {
                  block8 : {
                   $1_1 = HEAP32[(($9_1 << 2 | 0) + 291148 | 0) >> 2] | 0;
                   if (!$1_1) {
                    $0_1 = 0;
                    break block8;
                   }
                   $0_1 = 0;
                   $2_1 = $7_1 << (($9_1 | 0) != (31 | 0) ? 25 - ($9_1 >>> 1 | 0) | 0 : 0) | 0;
                   label2 : while (1) {
                    block9 : {
                     $5_1 = ((HEAP32[($1_1 + 4 | 0) >> 2] | 0) & -8 | 0) - $7_1 | 0;
                     if ($5_1 >>> 0 >= $3_1 >>> 0) {
                      break block9
                     }
                     $4_1 = $1_1;
                     $3_1 = $5_1;
                     if ($3_1) {
                      break block9
                     }
                     $3_1 = 0;
                     $0_1 = $1_1;
                     break block10;
                    }
                    $5_1 = HEAP32[($1_1 + 20 | 0) >> 2] | 0;
                    $1_1 = HEAP32[(($1_1 + (($2_1 >>> 29 | 0) & 4 | 0) | 0) + 16 | 0) >> 2] | 0;
                    $0_1 = $5_1 ? (($5_1 | 0) == ($1_1 | 0) ? $0_1 : $5_1) : $0_1;
                    $2_1 = $2_1 << 1 | 0;
                    if ($1_1) {
                     continue label2
                    }
                    break label2;
                   };
                  }
                  if (!($0_1 | $4_1 | 0)) {
                   $4_1 = 0;
                   $0_1 = 2 << $9_1 | 0;
                   $0_1 = ($0_1 | (0 - $0_1 | 0) | 0) & $8_1 | 0;
                   if (!$0_1) {
                    break block2
                   }
                   $0_1 = HEAP32[(((__wasm_ctz_i32($0_1 | 0) | 0) << 2 | 0) + 291148 | 0) >> 2] | 0;
                  }
                  if (!$0_1) {
                   break block11
                  }
                 }
                 label3 : while (1) {
                  $2_1 = ((HEAP32[($0_1 + 4 | 0) >> 2] | 0) & -8 | 0) - $7_1 | 0;
                  $1_1 = $2_1 >>> 0 < $3_1 >>> 0;
                  $3_1 = $1_1 ? $2_1 : $3_1;
                  $4_1 = $1_1 ? $0_1 : $4_1;
                  $1_1 = HEAP32[($0_1 + 16 | 0) >> 2] | 0;
                  if ($1_1) {
                   $356 = $1_1
                  } else {
                   $356 = HEAP32[($0_1 + 20 | 0) >> 2] | 0
                  }
                  $0_1 = $356;
                  if ($0_1) {
                   continue label3
                  }
                  break label3;
                 };
                }
                if (!$4_1) {
                 break block2
                }
                if ($3_1 >>> 0 >= ((HEAP32[290852 >> 2] | 0) - $7_1 | 0) >>> 0) {
                 break block2
                }
                $6_1 = HEAP32[($4_1 + 24 | 0) >> 2] | 0;
                $0_1 = HEAP32[($4_1 + 12 | 0) >> 2] | 0;
                if (($4_1 | 0) != ($0_1 | 0)) {
                 $1_1 = HEAP32[($4_1 + 8 | 0) >> 2] | 0;
                 HEAP32[($1_1 + 12 | 0) >> 2] = $0_1;
                 HEAP32[($0_1 + 8 | 0) >> 2] = $1_1;
                 break block12;
                }
                $1_1 = HEAP32[($4_1 + 20 | 0) >> 2] | 0;
                if ($1_1) {
                 $392 = $4_1 + 20 | 0
                } else {
                 $1_1 = HEAP32[($4_1 + 16 | 0) >> 2] | 0;
                 if (!$1_1) {
                  break block13
                 }
                 $392 = $4_1 + 16 | 0;
                }
                $2_1 = $392;
                label4 : while (1) {
                 $5_1 = $2_1;
                 $0_1 = $1_1;
                 $2_1 = $0_1 + 20 | 0;
                 $1_1 = HEAP32[($0_1 + 20 | 0) >> 2] | 0;
                 if ($1_1) {
                  continue label4
                 }
                 $2_1 = $0_1 + 16 | 0;
                 $1_1 = HEAP32[($0_1 + 16 | 0) >> 2] | 0;
                 if ($1_1) {
                  continue label4
                 }
                 break label4;
                };
                HEAP32[$5_1 >> 2] = 0;
                break block12;
               }
               $4_1 = HEAP32[290852 >> 2] | 0;
               if ($7_1 >>> 0 <= $4_1 >>> 0) {
                $0_1 = HEAP32[290864 >> 2] | 0;
                block14 : {
                 $1_1 = $4_1 - $7_1 | 0;
                 if ($1_1 >>> 0 >= 16 >>> 0) {
                  $2_1 = $0_1 + $7_1 | 0;
                  HEAP32[($2_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
                  HEAP32[($0_1 + $4_1 | 0) >> 2] = $1_1;
                  HEAP32[($0_1 + 4 | 0) >> 2] = $7_1 | 3 | 0;
                  break block14;
                 }
                 HEAP32[($0_1 + 4 | 0) >> 2] = $4_1 | 3 | 0;
                 $1_1 = $0_1 + $4_1 | 0;
                 HEAP32[($1_1 + 4 | 0) >> 2] = HEAP32[($1_1 + 4 | 0) >> 2] | 0 | 1 | 0;
                 $1_1 = 0;
                 $2_1 = 0;
                }
                HEAP32[290852 >> 2] = $1_1;
                HEAP32[290864 >> 2] = $2_1;
                $0_1 = $0_1 + 8 | 0;
                break block1;
               }
               $2_1 = HEAP32[290856 >> 2] | 0;
               if ($7_1 >>> 0 < $2_1 >>> 0) {
                $0_1 = $6_1 + $7_1 | 0;
                $1_1 = $2_1 - $7_1 | 0;
                HEAP32[($0_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
                HEAP32[290868 >> 2] = $0_1;
                HEAP32[290856 >> 2] = $1_1;
                HEAP32[($6_1 + 4 | 0) >> 2] = $7_1 | 3 | 0;
                $0_1 = $6_1 + 8 | 0;
                break block1;
               }
               $0_1 = 0;
               $8_1 = $7_1 + 71 | 0;
               $466 = $8_1;
               block15 : {
                if (HEAP32[291316 >> 2] | 0) {
                 $469 = HEAP32[291324 >> 2] | 0;
                 break block15;
                }
                HEAP32[291324 >> 2] = 65536;
                i64toi32_i32$1 = 291328;
                i64toi32_i32$0 = -1;
                HEAP32[i64toi32_i32$1 >> 2] = -1;
                HEAP32[(i64toi32_i32$1 + 4 | 0) >> 2] = i64toi32_i32$0;
                HEAP32[291320 >> 2] = 65536;
                HEAP32[291316 >> 2] = (($11_1 + 12 | 0) & -16 | 0) ^ 1431655768 | 0;
                HEAP32[291336 >> 2] = 0;
                HEAP32[291288 >> 2] = 0;
                $469 = 65536;
               }
               $1_1 = $469;
               $5_1 = $466 + $1_1 | 0;
               $9_1 = 0 - $1_1 | 0;
               $1_1 = $5_1 & $9_1 | 0;
               if ($1_1 >>> 0 <= $7_1 >>> 0) {
                break block1
               }
               $4_1 = HEAP32[291284 >> 2] | 0;
               if ($4_1) {
                $3_1 = HEAP32[291276 >> 2] | 0;
                $10_1 = $3_1 + $1_1 | 0;
                if ($10_1 >>> 0 <= $3_1 >>> 0) {
                 break block1
                }
                if ($4_1 >>> 0 < $10_1 >>> 0) {
                 break block1
                }
               }
               if ((HEAPU8[291288 >> 0] | 0) & 4 | 0) {
                break block16
               }
               block17 : {
                if ($6_1) {
                 $3_1 = 291292;
                 label5 : while (1) {
                  $10_1 = HEAP32[$3_1 >> 2] | 0;
                  if ($10_1 >>> 0 <= $6_1 >>> 0) {
                   if ($6_1 >>> 0 < ($10_1 + (HEAP32[($3_1 + 4 | 0) >> 2] | 0) | 0) >>> 0) {
                    break block17
                   }
                  }
                  $3_1 = HEAP32[($3_1 + 8 | 0) >> 2] | 0;
                  if ($3_1) {
                   continue label5
                  }
                  break label5;
                 };
                }
                $2_1 = __wasm_memory_size() << 16 | 0;
                if (($2_1 | 0) == (-1 | 0)) {
                 break block18
                }
                $5_1 = $1_1;
                $3_1 = HEAP32[291320 >> 2] | 0;
                $6_1 = $3_1 - 1 | 0;
                if ($6_1 & $2_1 | 0) {
                 $5_1 = ($1_1 - $2_1 | 0) + (($2_1 + $6_1 | 0) & (0 - $3_1 | 0) | 0) | 0
                }
                if ($5_1 >>> 0 <= $7_1 >>> 0) {
                 break block18
                }
                if ($5_1 >>> 0 > 2147483646 >>> 0) {
                 break block18
                }
                if ($4_1) {
                 $3_1 = HEAP32[291276 >> 2] | 0;
                 $6_1 = $3_1 + $5_1 | 0;
                 if ($6_1 >>> 0 <= $3_1 >>> 0) {
                  break block18
                 }
                 if ($4_1 >>> 0 < $6_1 >>> 0) {
                  break block18
                 }
                }
                $4_1 = $39($5_1 | 0) | 0;
                if (($4_1 | 0) == ($2_1 | 0)) {
                 break block19
                }
                $2_1 = $4_1;
                break block20;
               }
               $5_1 = ($5_1 - $2_1 | 0) & $9_1 | 0;
               if ($5_1 >>> 0 > 2147483646 >>> 0) {
                break block18
               }
               $2_1 = $39($5_1 | 0) | 0;
               if (($2_1 | 0) != ((HEAP32[$3_1 >> 2] | 0) + (HEAP32[($3_1 + 4 | 0) >> 2] | 0) | 0 | 0)) {
                break block20
               }
               if (($2_1 | 0) == (-1 | 0)) {
                break block18
               }
               break block19;
              }
              $0_1 = 0;
              break block6;
             }
             $0_1 = 0;
             break block12;
            }
            block21 : {
             if ($5_1 >>> 0 >= ($7_1 + 72 | 0) >>> 0) {
              break block21
             }
             if (($2_1 | 0) == (-1 | 0)) {
              break block21
             }
             $4_1 = HEAP32[291324 >> 2] | 0;
             $4_1 = ($4_1 + ($8_1 - $5_1 | 0) | 0) & (0 - $4_1 | 0) | 0;
             if ($4_1 >>> 0 > 2147483646 >>> 0) {
              break block19
             }
             if (($39($4_1 | 0) | 0 | 0) != (-1 | 0)) {
              $5_1 = $4_1 + $5_1 | 0;
              break block19;
             }
             $39(0 - $5_1 | 0 | 0) | 0;
             break block18;
            }
            if (($2_1 | 0) != (-1 | 0)) {
             break block19
            }
           }
           HEAP32[291288 >> 2] = HEAP32[291288 >> 2] | 0 | 4 | 0;
          }
          if ($1_1 >>> 0 > 2147483646 >>> 0) {
           break block1
          }
          $4_1 = $1_1 >>> 16 | 0;
          if (($1_1 | 0) != ($4_1 << 16 | 0 | 0)) {
           break block22
          }
          $1_1 = wasm2js_trap();
          $2_1 = ($1_1 | 0) == (-1 | 0) ? -1 : $1_1 << 16 | 0;
          if (($2_1 | 0) == (-1 | 0)) {
           break block1
          }
          $1_1 = __wasm_memory_size() << 16 | 0;
          if (($1_1 | 0) == (-1 | 0)) {
           break block1
          }
          if ($1_1 >>> 0 <= $2_1 >>> 0) {
           break block1
          }
          $5_1 = $1_1 - $2_1 | 0;
          if ($5_1 >>> 0 <= ($7_1 + 56 | 0) >>> 0) {
           break block1
          }
         }
         $0_1 = (HEAP32[291276 >> 2] | 0) + $5_1 | 0;
         HEAP32[291276 >> 2] = $0_1;
         if ((HEAP32[291280 >> 2] | 0) >>> 0 < $0_1 >>> 0) {
          HEAP32[291280 >> 2] = $0_1
         }
         block23 : {
          $3_1 = HEAP32[290868 >> 2] | 0;
          if ($3_1) {
           $0_1 = 291292;
           label6 : while (1) {
            $1_1 = HEAP32[$0_1 >> 2] | 0;
            $4_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
            if (($2_1 | 0) == ($1_1 + $4_1 | 0 | 0)) {
             break block23
            }
            $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
            if ($0_1) {
             continue label6
            }
            break label6;
           };
           break block24;
          }
          $0_1 = HEAP32[290860 >> 2] | 0;
          if (!($0_1 >>> 0 <= $2_1 >>> 0 ? $0_1 : 0)) {
           HEAP32[290860 >> 2] = $2_1
          }
          HEAP32[291296 >> 2] = $5_1;
          HEAP32[291292 >> 2] = $2_1;
          HEAP32[290896 >> 2] = 290884;
          HEAP32[290876 >> 2] = -1;
          HEAP32[290904 >> 2] = 290892;
          HEAP32[290892 >> 2] = 290884;
          HEAP32[290912 >> 2] = 290900;
          HEAP32[290900 >> 2] = 290892;
          HEAP32[290920 >> 2] = 290908;
          HEAP32[290908 >> 2] = 290900;
          HEAP32[290928 >> 2] = 290916;
          HEAP32[290916 >> 2] = 290908;
          HEAP32[290936 >> 2] = 290924;
          HEAP32[290924 >> 2] = 290916;
          HEAP32[290944 >> 2] = 290932;
          HEAP32[290932 >> 2] = 290924;
          HEAP32[290880 >> 2] = HEAP32[291316 >> 2] | 0;
          HEAP32[291304 >> 2] = 0;
          HEAP32[290952 >> 2] = 290940;
          HEAP32[290940 >> 2] = 290932;
          HEAP32[290948 >> 2] = 290940;
          HEAP32[290960 >> 2] = 290948;
          HEAP32[290956 >> 2] = 290948;
          HEAP32[290968 >> 2] = 290956;
          HEAP32[290964 >> 2] = 290956;
          HEAP32[290976 >> 2] = 290964;
          HEAP32[290972 >> 2] = 290964;
          HEAP32[290984 >> 2] = 290972;
          HEAP32[290980 >> 2] = 290972;
          HEAP32[290992 >> 2] = 290980;
          HEAP32[290988 >> 2] = 290980;
          HEAP32[291e3 >> 2] = 290988;
          HEAP32[290996 >> 2] = 290988;
          HEAP32[291008 >> 2] = 290996;
          HEAP32[291004 >> 2] = 290996;
          HEAP32[291016 >> 2] = 291004;
          HEAP32[291024 >> 2] = 291012;
          HEAP32[291012 >> 2] = 291004;
          HEAP32[291032 >> 2] = 291020;
          HEAP32[291020 >> 2] = 291012;
          HEAP32[291040 >> 2] = 291028;
          HEAP32[291028 >> 2] = 291020;
          HEAP32[291048 >> 2] = 291036;
          HEAP32[291036 >> 2] = 291028;
          HEAP32[291056 >> 2] = 291044;
          HEAP32[291044 >> 2] = 291036;
          HEAP32[291064 >> 2] = 291052;
          HEAP32[291052 >> 2] = 291044;
          HEAP32[291072 >> 2] = 291060;
          HEAP32[291060 >> 2] = 291052;
          HEAP32[291080 >> 2] = 291068;
          HEAP32[291068 >> 2] = 291060;
          HEAP32[291088 >> 2] = 291076;
          HEAP32[291076 >> 2] = 291068;
          HEAP32[291096 >> 2] = 291084;
          HEAP32[291084 >> 2] = 291076;
          HEAP32[291104 >> 2] = 291092;
          HEAP32[291092 >> 2] = 291084;
          HEAP32[291112 >> 2] = 291100;
          HEAP32[291100 >> 2] = 291092;
          HEAP32[291120 >> 2] = 291108;
          HEAP32[291108 >> 2] = 291100;
          HEAP32[291128 >> 2] = 291116;
          HEAP32[291116 >> 2] = 291108;
          HEAP32[291136 >> 2] = 291124;
          HEAP32[291124 >> 2] = 291116;
          HEAP32[291144 >> 2] = 291132;
          HEAP32[291132 >> 2] = 291124;
          HEAP32[291140 >> 2] = 291132;
          $0_1 = (-8 - $2_1 | 0) & 15 | 0;
          $1_1 = $2_1 + $0_1 | 0;
          HEAP32[290868 >> 2] = $1_1;
          $4_1 = $5_1 - 56 | 0;
          $0_1 = $4_1 - $0_1 | 0;
          HEAP32[290856 >> 2] = $0_1;
          HEAP32[($1_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
          HEAP32[(($2_1 + $4_1 | 0) + 4 | 0) >> 2] = 56;
          HEAP32[290872 >> 2] = HEAP32[291332 >> 2] | 0;
          break block25;
         }
         if ($2_1 >>> 0 <= $3_1 >>> 0) {
          break block24
         }
         if ($1_1 >>> 0 > $3_1 >>> 0) {
          break block24
         }
         if ((HEAP32[($0_1 + 12 | 0) >> 2] | 0) & 8 | 0) {
          break block24
         }
         $1_1 = (-8 - $3_1 | 0) & 15 | 0;
         $2_1 = $3_1 + $1_1 | 0;
         $6_1 = (HEAP32[290856 >> 2] | 0) + $5_1 | 0;
         $1_1 = $6_1 - $1_1 | 0;
         HEAP32[($2_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
         HEAP32[($0_1 + 4 | 0) >> 2] = $4_1 + $5_1 | 0;
         HEAP32[290872 >> 2] = HEAP32[291332 >> 2] | 0;
         HEAP32[290856 >> 2] = $1_1;
         HEAP32[290868 >> 2] = $2_1;
         HEAP32[(($3_1 + $6_1 | 0) + 4 | 0) >> 2] = 56;
         break block25;
        }
        wasm2js_trap();
       }
       if ((HEAP32[290860 >> 2] | 0) >>> 0 > $2_1 >>> 0) {
        HEAP32[290860 >> 2] = $2_1
       }
       $4_1 = $2_1 + $5_1 | 0;
       $0_1 = 291292;
       block26 : {
        label7 : while (1) {
         $1_1 = HEAP32[$0_1 >> 2] | 0;
         if (($4_1 | 0) != ($1_1 | 0)) {
          $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
          if ($0_1) {
           continue label7
          }
          break block26;
         }
         break label7;
        };
        if (!((HEAPU8[($0_1 + 12 | 0) >> 0] | 0) & 8 | 0)) {
         break block27
        }
       }
       $0_1 = 291292;
       label8 : while (1) {
        block28 : {
         $1_1 = HEAP32[$0_1 >> 2] | 0;
         if ($1_1 >>> 0 <= $3_1 >>> 0) {
          $4_1 = $1_1 + (HEAP32[($0_1 + 4 | 0) >> 2] | 0) | 0;
          if ($3_1 >>> 0 < $4_1 >>> 0) {
           break block28
          }
         }
         $0_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
         continue label8;
        }
        break label8;
       };
       $0_1 = (-8 - $2_1 | 0) & 15 | 0;
       $6_1 = $2_1 + $0_1 | 0;
       $1_1 = $5_1 - 56 | 0;
       $0_1 = $1_1 - $0_1 | 0;
       HEAP32[($6_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
       HEAP32[(($1_1 + $2_1 | 0) + 4 | 0) >> 2] = 56;
       $1_1 = ($4_1 + ((55 - $4_1 | 0) & 15 | 0) | 0) - 63 | 0;
       $1_1 = $1_1 >>> 0 < ($3_1 + 16 | 0) >>> 0 ? $3_1 : $1_1;
       HEAP32[($1_1 + 4 | 0) >> 2] = 35;
       HEAP32[290872 >> 2] = HEAP32[291332 >> 2] | 0;
       HEAP32[290856 >> 2] = $0_1;
       HEAP32[290868 >> 2] = $6_1;
       i64toi32_i32$2 = 291300;
       i64toi32_i32$0 = HEAP32[i64toi32_i32$2 >> 2] | 0;
       i64toi32_i32$1 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
       $791 = i64toi32_i32$0;
       i64toi32_i32$0 = $1_1;
       HEAP32[($1_1 + 16 | 0) >> 2] = $791;
       HEAP32[($1_1 + 20 | 0) >> 2] = i64toi32_i32$1;
       i64toi32_i32$2 = 291292;
       i64toi32_i32$1 = HEAP32[i64toi32_i32$2 >> 2] | 0;
       i64toi32_i32$0 = HEAP32[(i64toi32_i32$2 + 4 | 0) >> 2] | 0;
       $793 = i64toi32_i32$1;
       i64toi32_i32$1 = $1_1;
       HEAP32[($1_1 + 8 | 0) >> 2] = $793;
       HEAP32[($1_1 + 12 | 0) >> 2] = i64toi32_i32$0;
       HEAP32[291300 >> 2] = $1_1 + 8 | 0;
       HEAP32[291296 >> 2] = $5_1;
       HEAP32[291292 >> 2] = $2_1;
       HEAP32[291304 >> 2] = 0;
       $0_1 = $1_1 + 36 | 0;
       label9 : while (1) {
        HEAP32[$0_1 >> 2] = 7;
        $0_1 = $0_1 + 4 | 0;
        if ($0_1 >>> 0 < $4_1 >>> 0) {
         continue label9
        }
        break label9;
       };
       if (($1_1 | 0) == ($3_1 | 0)) {
        break block25
       }
       HEAP32[($1_1 + 4 | 0) >> 2] = (HEAP32[($1_1 + 4 | 0) >> 2] | 0) & -2 | 0;
       $2_1 = $1_1 - $3_1 | 0;
       HEAP32[$1_1 >> 2] = $2_1;
       HEAP32[($3_1 + 4 | 0) >> 2] = $2_1 | 1 | 0;
       block30 : {
        if ($2_1 >>> 0 <= 255 >>> 0) {
         $0_1 = ($2_1 & 248 | 0) + 290884 | 0;
         block29 : {
          $1_1 = HEAP32[290844 >> 2] | 0;
          $4_1 = 1 << ($2_1 >>> 3 | 0) | 0;
          if (!($1_1 & $4_1 | 0)) {
           HEAP32[290844 >> 2] = $1_1 | $4_1 | 0;
           $838 = $0_1;
           break block29;
          }
          $838 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
         }
         $1_1 = $838;
         HEAP32[($1_1 + 12 | 0) >> 2] = $3_1;
         HEAP32[($0_1 + 8 | 0) >> 2] = $3_1;
         $2_1 = 12;
         $846 = 8;
         break block30;
        }
        $0_1 = 31;
        if ($2_1 >>> 0 <= 16777215 >>> 0) {
         $0_1 = Math_clz32($2_1 >>> 8 | 0);
         $0_1 = (($2_1 >>> (38 - $0_1 | 0) | 0) & 1 | 0 | ($0_1 << 1 | 0) | 0) ^ 62 | 0;
        }
        HEAP32[($3_1 + 28 | 0) >> 2] = $0_1;
        i64toi32_i32$1 = $3_1;
        i64toi32_i32$0 = 0;
        HEAP32[($3_1 + 16 | 0) >> 2] = 0;
        HEAP32[($3_1 + 20 | 0) >> 2] = i64toi32_i32$0;
        $1_1 = ($0_1 << 2 | 0) + 291148 | 0;
        block32 : {
         block31 : {
          $4_1 = HEAP32[290848 >> 2] | 0;
          $5_1 = 1 << $0_1 | 0;
          if (!($4_1 & $5_1 | 0)) {
           HEAP32[$1_1 >> 2] = $3_1;
           HEAP32[290848 >> 2] = $4_1 | $5_1 | 0;
           break block31;
          }
          $0_1 = $2_1 << (($0_1 | 0) != (31 | 0) ? 25 - ($0_1 >>> 1 | 0) | 0 : 0) | 0;
          $4_1 = HEAP32[$1_1 >> 2] | 0;
          label10 : while (1) {
           $1_1 = $4_1;
           if (((HEAP32[($1_1 + 4 | 0) >> 2] | 0) & -8 | 0 | 0) == ($2_1 | 0)) {
            break block32
           }
           $4_1 = $0_1 >>> 29 | 0;
           $0_1 = $0_1 << 1 | 0;
           $5_1 = $1_1 + ($4_1 & 4 | 0) | 0;
           $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
           if ($4_1) {
            continue label10
           }
           break label10;
          };
          HEAP32[($5_1 + 16 | 0) >> 2] = $3_1;
         }
         HEAP32[($3_1 + 24 | 0) >> 2] = $1_1;
         $2_1 = 8;
         $1_1 = $3_1;
         $0_1 = $1_1;
         $846 = 12;
         break block30;
        }
        $0_1 = HEAP32[($1_1 + 8 | 0) >> 2] | 0;
        HEAP32[($1_1 + 8 | 0) >> 2] = $3_1;
        HEAP32[($0_1 + 12 | 0) >> 2] = $3_1;
        HEAP32[($3_1 + 8 | 0) >> 2] = $0_1;
        $0_1 = 0;
        $2_1 = 24;
        $846 = 12;
       }
       HEAP32[($846 + $3_1 | 0) >> 2] = $1_1;
       HEAP32[($2_1 + $3_1 | 0) >> 2] = $0_1;
      }
      $0_1 = 0;
      $1_1 = HEAP32[290856 >> 2] | 0;
      if ($1_1 >>> 0 <= $7_1 >>> 0) {
       break block1
      }
      $0_1 = HEAP32[290868 >> 2] | 0;
      $4_1 = $0_1 + $7_1 | 0;
      $1_1 = $1_1 - $7_1 | 0;
      HEAP32[($4_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
      HEAP32[290856 >> 2] = $1_1;
      HEAP32[290868 >> 2] = $4_1;
      HEAP32[($0_1 + 4 | 0) >> 2] = $7_1 | 3 | 0;
      $0_1 = $0_1 + 8 | 0;
      break block1;
     }
     HEAP32[$0_1 >> 2] = $2_1;
     HEAP32[($0_1 + 4 | 0) >> 2] = (HEAP32[($0_1 + 4 | 0) >> 2] | 0) + $5_1 | 0;
     $8_1 = $2_1 + ((-8 - $2_1 | 0) & 15 | 0) | 0;
     HEAP32[($8_1 + 4 | 0) >> 2] = $7_1 | 3 | 0;
     $5_1 = $1_1 + ((-8 - $1_1 | 0) & 15 | 0) | 0;
     $3_1 = $7_1 + $8_1 | 0;
     $6_1 = $5_1 - $3_1 | 0;
     block33 : {
      if ((HEAP32[290868 >> 2] | 0 | 0) == ($5_1 | 0)) {
       HEAP32[290868 >> 2] = $3_1;
       $0_1 = (HEAP32[290856 >> 2] | 0) + $6_1 | 0;
       HEAP32[290856 >> 2] = $0_1;
       HEAP32[($3_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
       break block33;
      }
      if ((HEAP32[290864 >> 2] | 0 | 0) == ($5_1 | 0)) {
       HEAP32[290864 >> 2] = $3_1;
       $0_1 = (HEAP32[290852 >> 2] | 0) + $6_1 | 0;
       HEAP32[290852 >> 2] = $0_1;
       HEAP32[($3_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
       HEAP32[($0_1 + $3_1 | 0) >> 2] = $0_1;
       break block33;
      }
      $4_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
      if (($4_1 & 3 | 0 | 0) == (1 | 0)) {
       $9_1 = $4_1 & -8 | 0;
       $1_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
       block34 : {
        if ($4_1 >>> 0 <= 255 >>> 0) {
         $0_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
         if (($0_1 | 0) == ($1_1 | 0)) {
          HEAP32[290844 >> 2] = (HEAP32[290844 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $4_1 >>> 3 | 0 | 0) | 0) | 0;
          break block34;
         }
         HEAP32[($1_1 + 8 | 0) >> 2] = $0_1;
         HEAP32[($0_1 + 12 | 0) >> 2] = $1_1;
         break block34;
        }
        $7_1 = HEAP32[($5_1 + 24 | 0) >> 2] | 0;
        block35 : {
         if (($1_1 | 0) != ($5_1 | 0)) {
          $0_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
          HEAP32[($0_1 + 12 | 0) >> 2] = $1_1;
          HEAP32[($1_1 + 8 | 0) >> 2] = $0_1;
          break block35;
         }
         block36 : {
          $4_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
          if ($4_1) {
           $1051 = $5_1 + 20 | 0
          } else {
           $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
           if (!$4_1) {
            break block36
           }
           $1051 = $5_1 + 16 | 0;
          }
          $0_1 = $1051;
          label11 : while (1) {
           $2_1 = $0_1;
           $1_1 = $4_1;
           $0_1 = $1_1 + 20 | 0;
           $4_1 = HEAP32[($1_1 + 20 | 0) >> 2] | 0;
           if ($4_1) {
            continue label11
           }
           $0_1 = $1_1 + 16 | 0;
           $4_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
           if ($4_1) {
            continue label11
           }
           break label11;
          };
          HEAP32[$2_1 >> 2] = 0;
          break block35;
         }
         $1_1 = 0;
        }
        if (!$7_1) {
         break block34
        }
        block37 : {
         $0_1 = HEAP32[($5_1 + 28 | 0) >> 2] | 0;
         $4_1 = $0_1 << 2 | 0;
         if ((HEAP32[($4_1 + 291148 | 0) >> 2] | 0 | 0) == ($5_1 | 0)) {
          HEAP32[($4_1 + 291148 | 0) >> 2] = $1_1;
          if ($1_1) {
           break block37
          }
          HEAP32[290848 >> 2] = (HEAP32[290848 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $0_1 | 0) | 0) | 0;
          break block34;
         }
         block38 : {
          if (($5_1 | 0) == (HEAP32[($7_1 + 16 | 0) >> 2] | 0 | 0)) {
           HEAP32[($7_1 + 16 | 0) >> 2] = $1_1;
           break block38;
          }
          HEAP32[($7_1 + 20 | 0) >> 2] = $1_1;
         }
         if (!$1_1) {
          break block34
         }
        }
        HEAP32[($1_1 + 24 | 0) >> 2] = $7_1;
        $0_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
        if ($0_1) {
         HEAP32[($1_1 + 16 | 0) >> 2] = $0_1;
         HEAP32[($0_1 + 24 | 0) >> 2] = $1_1;
        }
        $0_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
        if (!$0_1) {
         break block34
        }
        HEAP32[($1_1 + 20 | 0) >> 2] = $0_1;
        HEAP32[($0_1 + 24 | 0) >> 2] = $1_1;
       }
       $6_1 = $6_1 + $9_1 | 0;
       $5_1 = $5_1 + $9_1 | 0;
       $4_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
      }
      HEAP32[($5_1 + 4 | 0) >> 2] = $4_1 & -2 | 0;
      HEAP32[($3_1 + $6_1 | 0) >> 2] = $6_1;
      HEAP32[($3_1 + 4 | 0) >> 2] = $6_1 | 1 | 0;
      if ($6_1 >>> 0 <= 255 >>> 0) {
       $0_1 = ($6_1 & 248 | 0) + 290884 | 0;
       block39 : {
        $1_1 = HEAP32[290844 >> 2] | 0;
        $4_1 = 1 << ($6_1 >>> 3 | 0) | 0;
        if (!($1_1 & $4_1 | 0)) {
         HEAP32[290844 >> 2] = $1_1 | $4_1 | 0;
         $1146 = $0_1;
         break block39;
        }
        $1146 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
       }
       $1_1 = $1146;
       HEAP32[($1_1 + 12 | 0) >> 2] = $3_1;
       HEAP32[($0_1 + 8 | 0) >> 2] = $3_1;
       HEAP32[($3_1 + 12 | 0) >> 2] = $0_1;
       HEAP32[($3_1 + 8 | 0) >> 2] = $1_1;
       break block33;
      }
      $1_1 = 31;
      if ($6_1 >>> 0 <= 16777215 >>> 0) {
       $0_1 = Math_clz32($6_1 >>> 8 | 0);
       $1_1 = (($6_1 >>> (38 - $0_1 | 0) | 0) & 1 | 0 | ($0_1 << 1 | 0) | 0) ^ 62 | 0;
      }
      HEAP32[($3_1 + 28 | 0) >> 2] = $1_1;
      i64toi32_i32$1 = $3_1;
      i64toi32_i32$0 = 0;
      HEAP32[($3_1 + 16 | 0) >> 2] = 0;
      HEAP32[($3_1 + 20 | 0) >> 2] = i64toi32_i32$0;
      $0_1 = ($1_1 << 2 | 0) + 291148 | 0;
      $4_1 = HEAP32[290848 >> 2] | 0;
      $2_1 = 1 << $1_1 | 0;
      if (!($4_1 & $2_1 | 0)) {
       HEAP32[$0_1 >> 2] = $3_1;
       HEAP32[290848 >> 2] = $2_1 | $4_1 | 0;
       HEAP32[($3_1 + 24 | 0) >> 2] = $0_1;
       HEAP32[($3_1 + 8 | 0) >> 2] = $3_1;
       HEAP32[($3_1 + 12 | 0) >> 2] = $3_1;
       break block33;
      }
      $1_1 = $6_1 << (($1_1 | 0) != (31 | 0) ? 25 - ($1_1 >>> 1 | 0) | 0 : 0) | 0;
      $0_1 = HEAP32[$0_1 >> 2] | 0;
      block40 : {
       label12 : while (1) {
        $4_1 = $0_1;
        if (((HEAP32[($0_1 + 4 | 0) >> 2] | 0) & -8 | 0 | 0) == ($6_1 | 0)) {
         break block40
        }
        $0_1 = $1_1 >>> 29 | 0;
        $1_1 = $1_1 << 1 | 0;
        $2_1 = $4_1 + ($0_1 & 4 | 0) | 0;
        $0_1 = HEAP32[($2_1 + 16 | 0) >> 2] | 0;
        if ($0_1) {
         continue label12
        }
        break label12;
       };
       HEAP32[($2_1 + 16 | 0) >> 2] = $3_1;
       HEAP32[($3_1 + 24 | 0) >> 2] = $4_1;
       HEAP32[($3_1 + 12 | 0) >> 2] = $3_1;
       HEAP32[($3_1 + 8 | 0) >> 2] = $3_1;
       break block33;
      }
      $0_1 = HEAP32[($4_1 + 8 | 0) >> 2] | 0;
      HEAP32[($0_1 + 12 | 0) >> 2] = $3_1;
      HEAP32[($4_1 + 8 | 0) >> 2] = $3_1;
      HEAP32[($3_1 + 24 | 0) >> 2] = 0;
      HEAP32[($3_1 + 12 | 0) >> 2] = $4_1;
      HEAP32[($3_1 + 8 | 0) >> 2] = $0_1;
     }
     $0_1 = $8_1 + 8 | 0;
     break block1;
    }
    block41 : {
     if (!$6_1) {
      break block41
     }
     block42 : {
      $1_1 = HEAP32[($4_1 + 28 | 0) >> 2] | 0;
      $2_1 = $1_1 << 2 | 0;
      if ((HEAP32[($2_1 + 291148 | 0) >> 2] | 0 | 0) == ($4_1 | 0)) {
       HEAP32[($2_1 + 291148 | 0) >> 2] = $0_1;
       if ($0_1) {
        break block42
       }
       $8_1 = $8_1 & (__wasm_rotl_i32(-2 | 0, $1_1 | 0) | 0) | 0;
       HEAP32[290848 >> 2] = $8_1;
       break block41;
      }
      block43 : {
       if (($4_1 | 0) == (HEAP32[($6_1 + 16 | 0) >> 2] | 0 | 0)) {
        HEAP32[($6_1 + 16 | 0) >> 2] = $0_1;
        break block43;
       }
       HEAP32[($6_1 + 20 | 0) >> 2] = $0_1;
      }
      if (!$0_1) {
       break block41
      }
     }
     HEAP32[($0_1 + 24 | 0) >> 2] = $6_1;
     $1_1 = HEAP32[($4_1 + 16 | 0) >> 2] | 0;
     if ($1_1) {
      HEAP32[($0_1 + 16 | 0) >> 2] = $1_1;
      HEAP32[($1_1 + 24 | 0) >> 2] = $0_1;
     }
     $1_1 = HEAP32[($4_1 + 20 | 0) >> 2] | 0;
     if (!$1_1) {
      break block41
     }
     HEAP32[($0_1 + 20 | 0) >> 2] = $1_1;
     HEAP32[($1_1 + 24 | 0) >> 2] = $0_1;
    }
    block44 : {
     if ($3_1 >>> 0 <= 15 >>> 0) {
      $0_1 = $3_1 | $7_1 | 0;
      HEAP32[($4_1 + 4 | 0) >> 2] = $0_1 | 3 | 0;
      $0_1 = $0_1 + $4_1 | 0;
      HEAP32[($0_1 + 4 | 0) >> 2] = HEAP32[($0_1 + 4 | 0) >> 2] | 0 | 1 | 0;
      break block44;
     }
     $5_1 = $4_1 + $7_1 | 0;
     HEAP32[($5_1 + 4 | 0) >> 2] = $3_1 | 1 | 0;
     HEAP32[($4_1 + 4 | 0) >> 2] = $7_1 | 3 | 0;
     HEAP32[($3_1 + $5_1 | 0) >> 2] = $3_1;
     if ($3_1 >>> 0 <= 255 >>> 0) {
      $0_1 = ($3_1 & 248 | 0) + 290884 | 0;
      block45 : {
       $1_1 = HEAP32[290844 >> 2] | 0;
       $2_1 = 1 << ($3_1 >>> 3 | 0) | 0;
       if (!($1_1 & $2_1 | 0)) {
        HEAP32[290844 >> 2] = $1_1 | $2_1 | 0;
        $1336 = $0_1;
        break block45;
       }
       $1336 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
      }
      $1_1 = $1336;
      HEAP32[($1_1 + 12 | 0) >> 2] = $5_1;
      HEAP32[($0_1 + 8 | 0) >> 2] = $5_1;
      HEAP32[($5_1 + 12 | 0) >> 2] = $0_1;
      HEAP32[($5_1 + 8 | 0) >> 2] = $1_1;
      break block44;
     }
     $0_1 = 31;
     if ($3_1 >>> 0 <= 16777215 >>> 0) {
      $0_1 = Math_clz32($3_1 >>> 8 | 0);
      $0_1 = (($3_1 >>> (38 - $0_1 | 0) | 0) & 1 | 0 | ($0_1 << 1 | 0) | 0) ^ 62 | 0;
     }
     HEAP32[($5_1 + 28 | 0) >> 2] = $0_1;
     i64toi32_i32$1 = $5_1;
     i64toi32_i32$0 = 0;
     HEAP32[($5_1 + 16 | 0) >> 2] = 0;
     HEAP32[($5_1 + 20 | 0) >> 2] = i64toi32_i32$0;
     $1_1 = ($0_1 << 2 | 0) + 291148 | 0;
     $2_1 = 1 << $0_1 | 0;
     if (!($8_1 & $2_1 | 0)) {
      HEAP32[$1_1 >> 2] = $5_1;
      HEAP32[290848 >> 2] = $2_1 | $8_1 | 0;
      HEAP32[($5_1 + 24 | 0) >> 2] = $1_1;
      HEAP32[($5_1 + 8 | 0) >> 2] = $5_1;
      HEAP32[($5_1 + 12 | 0) >> 2] = $5_1;
      break block44;
     }
     $0_1 = $3_1 << (($0_1 | 0) != (31 | 0) ? 25 - ($0_1 >>> 1 | 0) | 0 : 0) | 0;
     $1_1 = HEAP32[$1_1 >> 2] | 0;
     block46 : {
      label13 : while (1) {
       $2_1 = $1_1;
       if (((HEAP32[($1_1 + 4 | 0) >> 2] | 0) & -8 | 0 | 0) == ($3_1 | 0)) {
        break block46
       }
       $1_1 = $0_1 >>> 29 | 0;
       $0_1 = $0_1 << 1 | 0;
       $6_1 = $2_1 + ($1_1 & 4 | 0) | 0;
       $1_1 = HEAP32[($6_1 + 16 | 0) >> 2] | 0;
       if ($1_1) {
        continue label13
       }
       break label13;
      };
      HEAP32[($6_1 + 16 | 0) >> 2] = $5_1;
      HEAP32[($5_1 + 24 | 0) >> 2] = $2_1;
      HEAP32[($5_1 + 12 | 0) >> 2] = $5_1;
      HEAP32[($5_1 + 8 | 0) >> 2] = $5_1;
      break block44;
     }
     $0_1 = HEAP32[($2_1 + 8 | 0) >> 2] | 0;
     HEAP32[($0_1 + 12 | 0) >> 2] = $5_1;
     HEAP32[($2_1 + 8 | 0) >> 2] = $5_1;
     HEAP32[($5_1 + 24 | 0) >> 2] = 0;
     HEAP32[($5_1 + 12 | 0) >> 2] = $2_1;
     HEAP32[($5_1 + 8 | 0) >> 2] = $0_1;
    }
    $0_1 = $4_1 + 8 | 0;
    break block1;
   }
   block47 : {
    if (!$9_1) {
     break block47
    }
    block48 : {
     $1_1 = HEAP32[($2_1 + 28 | 0) >> 2] | 0;
     $4_1 = $1_1 << 2 | 0;
     if ((HEAP32[($4_1 + 291148 | 0) >> 2] | 0 | 0) == ($2_1 | 0)) {
      HEAP32[($4_1 + 291148 | 0) >> 2] = $0_1;
      if ($0_1) {
       break block48
      }
      HEAP32[290848 >> 2] = $10_1 & (__wasm_rotl_i32(-2 | 0, $1_1 | 0) | 0) | 0;
      break block47;
     }
     block49 : {
      if (($2_1 | 0) == (HEAP32[($9_1 + 16 | 0) >> 2] | 0 | 0)) {
       HEAP32[($9_1 + 16 | 0) >> 2] = $0_1;
       break block49;
      }
      HEAP32[($9_1 + 20 | 0) >> 2] = $0_1;
     }
     if (!$0_1) {
      break block47
     }
    }
    HEAP32[($0_1 + 24 | 0) >> 2] = $9_1;
    $1_1 = HEAP32[($2_1 + 16 | 0) >> 2] | 0;
    if ($1_1) {
     HEAP32[($0_1 + 16 | 0) >> 2] = $1_1;
     HEAP32[($1_1 + 24 | 0) >> 2] = $0_1;
    }
    $1_1 = HEAP32[($2_1 + 20 | 0) >> 2] | 0;
    if (!$1_1) {
     break block47
    }
    HEAP32[($0_1 + 20 | 0) >> 2] = $1_1;
    HEAP32[($1_1 + 24 | 0) >> 2] = $0_1;
   }
   block50 : {
    if ($3_1 >>> 0 <= 15 >>> 0) {
     $0_1 = $3_1 | $7_1 | 0;
     HEAP32[($2_1 + 4 | 0) >> 2] = $0_1 | 3 | 0;
     $0_1 = $0_1 + $2_1 | 0;
     HEAP32[($0_1 + 4 | 0) >> 2] = HEAP32[($0_1 + 4 | 0) >> 2] | 0 | 1 | 0;
     break block50;
    }
    $4_1 = $2_1 + $7_1 | 0;
    HEAP32[($4_1 + 4 | 0) >> 2] = $3_1 | 1 | 0;
    HEAP32[($2_1 + 4 | 0) >> 2] = $7_1 | 3 | 0;
    HEAP32[($3_1 + $4_1 | 0) >> 2] = $3_1;
    if ($8_1) {
     $0_1 = ($8_1 & -8 | 0) + 290884 | 0;
     $1_1 = HEAP32[290864 >> 2] | 0;
     block51 : {
      $6_1 = 1 << ($8_1 >>> 3 | 0) | 0;
      if (!($6_1 & $5_1 | 0)) {
       HEAP32[290844 >> 2] = $5_1 | $6_1 | 0;
       $1523 = $0_1;
       break block51;
      }
      $1523 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
     }
     $5_1 = $1523;
     HEAP32[($5_1 + 12 | 0) >> 2] = $1_1;
     HEAP32[($0_1 + 8 | 0) >> 2] = $1_1;
     HEAP32[($1_1 + 12 | 0) >> 2] = $0_1;
     HEAP32[($1_1 + 8 | 0) >> 2] = $5_1;
    }
    HEAP32[290864 >> 2] = $4_1;
    HEAP32[290852 >> 2] = $3_1;
   }
   $0_1 = $2_1 + 8 | 0;
  }
  global$0 = $11_1 + 16 | 0;
  return $0_1 | 0;
 }
 
 function $37($0_1) {
  $0_1 = $0_1 | 0;
  var $2_1 = 0, $1_1 = 0, $3_1 = 0, $4_1 = 0, $5_1 = 0, $6_1 = 0, $7_1 = 0, $8_1 = 0, $78 = 0, $243 = 0, $341 = 0, $385 = 0, $420 = 0;
  block : {
   if (!$0_1) {
    break block
   }
   $3_1 = $0_1 - 8 | 0;
   $2_1 = HEAP32[($0_1 - 4 | 0) >> 2] | 0;
   $0_1 = $2_1 & -8 | 0;
   $5_1 = $3_1 + $0_1 | 0;
   block1 : {
    if ($2_1 & 1 | 0) {
     break block1
    }
    if (!($2_1 & 2 | 0)) {
     break block
    }
    $4_1 = HEAP32[$3_1 >> 2] | 0;
    $3_1 = $3_1 - $4_1 | 0;
    if ($3_1 >>> 0 < (HEAP32[290860 >> 2] | 0) >>> 0) {
     break block
    }
    $0_1 = $0_1 + $4_1 | 0;
    block3 : {
     block4 : {
      block2 : {
       if ((HEAP32[290864 >> 2] | 0 | 0) != ($3_1 | 0)) {
        $1_1 = HEAP32[($3_1 + 12 | 0) >> 2] | 0;
        if ($4_1 >>> 0 <= 255 >>> 0) {
         $2_1 = HEAP32[($3_1 + 8 | 0) >> 2] | 0;
         if (($1_1 | 0) != ($2_1 | 0)) {
          break block2
         }
         HEAP32[290844 >> 2] = (HEAP32[290844 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $4_1 >>> 3 | 0 | 0) | 0) | 0;
         break block1;
        }
        $7_1 = HEAP32[($3_1 + 24 | 0) >> 2] | 0;
        if (($1_1 | 0) != ($3_1 | 0)) {
         $2_1 = HEAP32[($3_1 + 8 | 0) >> 2] | 0;
         HEAP32[($2_1 + 12 | 0) >> 2] = $1_1;
         HEAP32[($1_1 + 8 | 0) >> 2] = $2_1;
         break block3;
        }
        $2_1 = HEAP32[($3_1 + 20 | 0) >> 2] | 0;
        if ($2_1) {
         $78 = $3_1 + 20 | 0
        } else {
         $2_1 = HEAP32[($3_1 + 16 | 0) >> 2] | 0;
         if (!$2_1) {
          break block4
         }
         $78 = $3_1 + 16 | 0;
        }
        $4_1 = $78;
        label : while (1) {
         $6_1 = $4_1;
         $1_1 = $2_1;
         $4_1 = $2_1 + 20 | 0;
         $2_1 = HEAP32[($2_1 + 20 | 0) >> 2] | 0;
         if ($2_1) {
          continue label
         }
         $4_1 = $1_1 + 16 | 0;
         $2_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
         if ($2_1) {
          continue label
         }
         break label;
        };
        HEAP32[$6_1 >> 2] = 0;
        break block3;
       }
       $2_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
       if (($2_1 & 3 | 0 | 0) != (3 | 0)) {
        break block1
       }
       HEAP32[($5_1 + 4 | 0) >> 2] = $2_1 & -2 | 0;
       HEAP32[290852 >> 2] = $0_1;
       HEAP32[$5_1 >> 2] = $0_1;
       HEAP32[($3_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
       return;
      }
      HEAP32[($1_1 + 8 | 0) >> 2] = $2_1;
      HEAP32[($2_1 + 12 | 0) >> 2] = $1_1;
      break block1;
     }
     $1_1 = 0;
    }
    if (!$7_1) {
     break block1
    }
    block5 : {
     $4_1 = HEAP32[($3_1 + 28 | 0) >> 2] | 0;
     $2_1 = $4_1 << 2 | 0;
     if ((HEAP32[($2_1 + 291148 | 0) >> 2] | 0 | 0) == ($3_1 | 0)) {
      HEAP32[($2_1 + 291148 | 0) >> 2] = $1_1;
      if ($1_1) {
       break block5
      }
      HEAP32[290848 >> 2] = (HEAP32[290848 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $4_1 | 0) | 0) | 0;
      break block1;
     }
     block6 : {
      if (($3_1 | 0) == (HEAP32[($7_1 + 16 | 0) >> 2] | 0 | 0)) {
       HEAP32[($7_1 + 16 | 0) >> 2] = $1_1;
       break block6;
      }
      HEAP32[($7_1 + 20 | 0) >> 2] = $1_1;
     }
     if (!$1_1) {
      break block1
     }
    }
    HEAP32[($1_1 + 24 | 0) >> 2] = $7_1;
    $2_1 = HEAP32[($3_1 + 16 | 0) >> 2] | 0;
    if ($2_1) {
     HEAP32[($1_1 + 16 | 0) >> 2] = $2_1;
     HEAP32[($2_1 + 24 | 0) >> 2] = $1_1;
    }
    $2_1 = HEAP32[($3_1 + 20 | 0) >> 2] | 0;
    if (!$2_1) {
     break block1
    }
    HEAP32[($1_1 + 20 | 0) >> 2] = $2_1;
    HEAP32[($2_1 + 24 | 0) >> 2] = $1_1;
   }
   if ($3_1 >>> 0 >= $5_1 >>> 0) {
    break block
   }
   $4_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
   if (!($4_1 & 1 | 0)) {
    break block
   }
   block10 : {
    block7 : {
     block8 : {
      block9 : {
       if (!($4_1 & 2 | 0)) {
        if ((HEAP32[290868 >> 2] | 0 | 0) == ($5_1 | 0)) {
         HEAP32[290868 >> 2] = $3_1;
         $0_1 = (HEAP32[290856 >> 2] | 0) + $0_1 | 0;
         HEAP32[290856 >> 2] = $0_1;
         HEAP32[($3_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
         if (($3_1 | 0) != (HEAP32[290864 >> 2] | 0 | 0)) {
          break block
         }
         HEAP32[290852 >> 2] = 0;
         HEAP32[290864 >> 2] = 0;
         return;
        }
        $7_1 = HEAP32[290864 >> 2] | 0;
        if (($7_1 | 0) == ($5_1 | 0)) {
         HEAP32[290864 >> 2] = $3_1;
         $0_1 = (HEAP32[290852 >> 2] | 0) + $0_1 | 0;
         HEAP32[290852 >> 2] = $0_1;
         HEAP32[($3_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
         HEAP32[($0_1 + $3_1 | 0) >> 2] = $0_1;
         return;
        }
        $0_1 = ($4_1 & -8 | 0) + $0_1 | 0;
        $1_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
        if ($4_1 >>> 0 <= 255 >>> 0) {
         $2_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
         if (($2_1 | 0) == ($1_1 | 0)) {
          HEAP32[290844 >> 2] = (HEAP32[290844 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $4_1 >>> 3 | 0 | 0) | 0) | 0;
          break block7;
         }
         HEAP32[($1_1 + 8 | 0) >> 2] = $2_1;
         HEAP32[($2_1 + 12 | 0) >> 2] = $1_1;
         break block7;
        }
        $8_1 = HEAP32[($5_1 + 24 | 0) >> 2] | 0;
        if (($1_1 | 0) != ($5_1 | 0)) {
         $2_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
         HEAP32[($2_1 + 12 | 0) >> 2] = $1_1;
         HEAP32[($1_1 + 8 | 0) >> 2] = $2_1;
         break block8;
        }
        $2_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
        if ($2_1) {
         $243 = $5_1 + 20 | 0
        } else {
         $2_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
         if (!$2_1) {
          break block9
         }
         $243 = $5_1 + 16 | 0;
        }
        $4_1 = $243;
        label1 : while (1) {
         $6_1 = $4_1;
         $1_1 = $2_1;
         $4_1 = $2_1 + 20 | 0;
         $2_1 = HEAP32[($2_1 + 20 | 0) >> 2] | 0;
         if ($2_1) {
          continue label1
         }
         $4_1 = $1_1 + 16 | 0;
         $2_1 = HEAP32[($1_1 + 16 | 0) >> 2] | 0;
         if ($2_1) {
          continue label1
         }
         break label1;
        };
        HEAP32[$6_1 >> 2] = 0;
        break block8;
       }
       HEAP32[($5_1 + 4 | 0) >> 2] = $4_1 & -2 | 0;
       HEAP32[($0_1 + $3_1 | 0) >> 2] = $0_1;
       HEAP32[($3_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
       break block10;
      }
      $1_1 = 0;
     }
     if (!$8_1) {
      break block7
     }
     block11 : {
      $4_1 = HEAP32[($5_1 + 28 | 0) >> 2] | 0;
      $2_1 = $4_1 << 2 | 0;
      if ((HEAP32[($2_1 + 291148 | 0) >> 2] | 0 | 0) == ($5_1 | 0)) {
       HEAP32[($2_1 + 291148 | 0) >> 2] = $1_1;
       if ($1_1) {
        break block11
       }
       HEAP32[290848 >> 2] = (HEAP32[290848 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $4_1 | 0) | 0) | 0;
       break block7;
      }
      block12 : {
       if (($5_1 | 0) == (HEAP32[($8_1 + 16 | 0) >> 2] | 0 | 0)) {
        HEAP32[($8_1 + 16 | 0) >> 2] = $1_1;
        break block12;
       }
       HEAP32[($8_1 + 20 | 0) >> 2] = $1_1;
      }
      if (!$1_1) {
       break block7
      }
     }
     HEAP32[($1_1 + 24 | 0) >> 2] = $8_1;
     $2_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
     if ($2_1) {
      HEAP32[($1_1 + 16 | 0) >> 2] = $2_1;
      HEAP32[($2_1 + 24 | 0) >> 2] = $1_1;
     }
     $2_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
     if (!$2_1) {
      break block7
     }
     HEAP32[($1_1 + 20 | 0) >> 2] = $2_1;
     HEAP32[($2_1 + 24 | 0) >> 2] = $1_1;
    }
    HEAP32[($0_1 + $3_1 | 0) >> 2] = $0_1;
    HEAP32[($3_1 + 4 | 0) >> 2] = $0_1 | 1 | 0;
    if (($3_1 | 0) != ($7_1 | 0)) {
     break block10
    }
    HEAP32[290852 >> 2] = $0_1;
    return;
   }
   if ($0_1 >>> 0 <= 255 >>> 0) {
    $2_1 = ($0_1 & 248 | 0) + 290884 | 0;
    block13 : {
     $4_1 = HEAP32[290844 >> 2] | 0;
     $0_1 = 1 << ($0_1 >>> 3 | 0) | 0;
     if (!($4_1 & $0_1 | 0)) {
      HEAP32[290844 >> 2] = $0_1 | $4_1 | 0;
      $341 = $2_1;
      break block13;
     }
     $341 = HEAP32[($2_1 + 8 | 0) >> 2] | 0;
    }
    $0_1 = $341;
    HEAP32[($0_1 + 12 | 0) >> 2] = $3_1;
    HEAP32[($2_1 + 8 | 0) >> 2] = $3_1;
    HEAP32[($3_1 + 12 | 0) >> 2] = $2_1;
    HEAP32[($3_1 + 8 | 0) >> 2] = $0_1;
    return;
   }
   $1_1 = 31;
   if ($0_1 >>> 0 <= 16777215 >>> 0) {
    $2_1 = Math_clz32($0_1 >>> 8 | 0);
    $1_1 = (($0_1 >>> (38 - $2_1 | 0) | 0) & 1 | 0 | ($2_1 << 1 | 0) | 0) ^ 62 | 0;
   }
   HEAP32[($3_1 + 28 | 0) >> 2] = $1_1;
   HEAP32[($3_1 + 16 | 0) >> 2] = 0;
   HEAP32[($3_1 + 20 | 0) >> 2] = 0;
   $4_1 = ($1_1 << 2 | 0) + 291148 | 0;
   block16 : {
    block15 : {
     block14 : {
      $6_1 = HEAP32[290848 >> 2] | 0;
      $2_1 = 1 << $1_1 | 0;
      if (!($6_1 & $2_1 | 0)) {
       HEAP32[$4_1 >> 2] = $3_1;
       HEAP32[290848 >> 2] = $2_1 | $6_1 | 0;
       $1_1 = 24;
       $385 = 8;
       break block14;
      }
      $1_1 = $0_1 << (($1_1 | 0) != (31 | 0) ? 25 - ($1_1 >>> 1 | 0) | 0 : 0) | 0;
      $4_1 = HEAP32[$4_1 >> 2] | 0;
      label2 : while (1) {
       $2_1 = $4_1;
       if (((HEAP32[($2_1 + 4 | 0) >> 2] | 0) & -8 | 0 | 0) == ($0_1 | 0)) {
        break block15
       }
       $4_1 = $1_1 >>> 29 | 0;
       $1_1 = $1_1 << 1 | 0;
       $6_1 = $2_1 + ($4_1 & 4 | 0) | 0;
       $4_1 = HEAP32[($6_1 + 16 | 0) >> 2] | 0;
       if ($4_1) {
        continue label2
       }
       break label2;
      };
      HEAP32[($6_1 + 16 | 0) >> 2] = $3_1;
      $1_1 = 24;
      $4_1 = $2_1;
      $385 = 8;
     }
     $0_1 = $385;
     $2_1 = $3_1;
     $420 = $2_1;
     break block16;
    }
    $4_1 = HEAP32[($2_1 + 8 | 0) >> 2] | 0;
    HEAP32[($4_1 + 12 | 0) >> 2] = $3_1;
    HEAP32[($2_1 + 8 | 0) >> 2] = $3_1;
    $0_1 = 24;
    $1_1 = 8;
    $420 = 0;
   }
   $6_1 = $420;
   HEAP32[($1_1 + $3_1 | 0) >> 2] = $4_1;
   HEAP32[($3_1 + 12 | 0) >> 2] = $2_1;
   HEAP32[($0_1 + $3_1 | 0) >> 2] = $6_1;
   $0_1 = (HEAP32[290876 >> 2] | 0) - 1 | 0;
   HEAP32[290876 >> 2] = $0_1 ? $0_1 : -1;
  }
 }
 
 function $38($0_1) {
  $0_1 = $0_1 | 0;
  fimport$3($0_1 | 0);
  wasm2js_trap();
 }
 
 function $39($0_1) {
  $0_1 = $0_1 | 0;
  var $1_1 = 0, $21_1 = 0, $23_1 = 0;
  if (!$0_1) {
   return __wasm_memory_size() << 16 | 0 | 0
  }
  block : {
   $1_1 = $0_1 >>> 16 | 0;
   if (($0_1 | 0) != ($1_1 << 16 | 0 | 0)) {
    break block
   }
   if (($0_1 | 0) < (0 | 0)) {
    break block
   }
   $0_1 = wasm2js_trap();
   if (($0_1 | 0) != (-1 | 0)) {
    $21_1 = $0_1 << 16 | 0
   } else {
    $21_1 = -1
   }
   return $21_1 | 0;
  }
  wasm2js_trap();
 }
 
 function $40($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  var $2_1 = 0, $3_1 = 0, $4_1 = 0, $5_1 = 0, $6_1 = 0, $7_1 = 0, $68 = 0, $8_1 = 0, $227 = 0, $325 = 0;
  $5_1 = $0_1 + $1_1 | 0;
  block1 : {
   block : {
    $2_1 = HEAP32[($0_1 + 4 | 0) >> 2] | 0;
    if ($2_1 & 1 | 0) {
     break block
    }
    if (!($2_1 & 2 | 0)) {
     break block1
    }
    $2_1 = HEAP32[$0_1 >> 2] | 0;
    $1_1 = $2_1 + $1_1 | 0;
    block3 : {
     block4 : {
      block2 : {
       $0_1 = $0_1 - $2_1 | 0;
       if (($0_1 | 0) != (HEAP32[290864 >> 2] | 0 | 0)) {
        $3_1 = HEAP32[($0_1 + 12 | 0) >> 2] | 0;
        if ($2_1 >>> 0 <= 255 >>> 0) {
         $4_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
         if (($3_1 | 0) != ($4_1 | 0)) {
          break block2
         }
         HEAP32[290844 >> 2] = (HEAP32[290844 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $2_1 >>> 3 | 0 | 0) | 0) | 0;
         break block;
        }
        $6_1 = HEAP32[($0_1 + 24 | 0) >> 2] | 0;
        if (($0_1 | 0) != ($3_1 | 0)) {
         $2_1 = HEAP32[($0_1 + 8 | 0) >> 2] | 0;
         HEAP32[($2_1 + 12 | 0) >> 2] = $3_1;
         HEAP32[($3_1 + 8 | 0) >> 2] = $2_1;
         break block3;
        }
        $4_1 = HEAP32[($0_1 + 20 | 0) >> 2] | 0;
        if ($4_1) {
         $68 = $0_1 + 20 | 0
        } else {
         $4_1 = HEAP32[($0_1 + 16 | 0) >> 2] | 0;
         if (!$4_1) {
          break block4
         }
         $68 = $0_1 + 16 | 0;
        }
        $2_1 = $68;
        label : while (1) {
         $7_1 = $2_1;
         $3_1 = $4_1;
         $2_1 = $3_1 + 20 | 0;
         $4_1 = HEAP32[($3_1 + 20 | 0) >> 2] | 0;
         if ($4_1) {
          continue label
         }
         $2_1 = $3_1 + 16 | 0;
         $4_1 = HEAP32[($3_1 + 16 | 0) >> 2] | 0;
         if ($4_1) {
          continue label
         }
         break label;
        };
        HEAP32[$7_1 >> 2] = 0;
        break block3;
       }
       $2_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
       if (($2_1 & 3 | 0 | 0) != (3 | 0)) {
        break block
       }
       HEAP32[($5_1 + 4 | 0) >> 2] = $2_1 & -2 | 0;
       HEAP32[290852 >> 2] = $1_1;
       HEAP32[$5_1 >> 2] = $1_1;
       HEAP32[($0_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
       return;
      }
      HEAP32[($3_1 + 8 | 0) >> 2] = $4_1;
      HEAP32[($4_1 + 12 | 0) >> 2] = $3_1;
      break block;
     }
     $3_1 = 0;
    }
    if (!$6_1) {
     break block
    }
    block5 : {
     $2_1 = HEAP32[($0_1 + 28 | 0) >> 2] | 0;
     $4_1 = $2_1 << 2 | 0;
     if ((HEAP32[($4_1 + 291148 | 0) >> 2] | 0 | 0) == ($0_1 | 0)) {
      HEAP32[($4_1 + 291148 | 0) >> 2] = $3_1;
      if ($3_1) {
       break block5
      }
      HEAP32[290848 >> 2] = (HEAP32[290848 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $2_1 | 0) | 0) | 0;
      break block;
     }
     block6 : {
      if (($0_1 | 0) == (HEAP32[($6_1 + 16 | 0) >> 2] | 0 | 0)) {
       HEAP32[($6_1 + 16 | 0) >> 2] = $3_1;
       break block6;
      }
      HEAP32[($6_1 + 20 | 0) >> 2] = $3_1;
     }
     if (!$3_1) {
      break block
     }
    }
    HEAP32[($3_1 + 24 | 0) >> 2] = $6_1;
    $2_1 = HEAP32[($0_1 + 16 | 0) >> 2] | 0;
    if ($2_1) {
     HEAP32[($3_1 + 16 | 0) >> 2] = $2_1;
     HEAP32[($2_1 + 24 | 0) >> 2] = $3_1;
    }
    $2_1 = HEAP32[($0_1 + 20 | 0) >> 2] | 0;
    if (!$2_1) {
     break block
    }
    HEAP32[($3_1 + 20 | 0) >> 2] = $2_1;
    HEAP32[($2_1 + 24 | 0) >> 2] = $3_1;
   }
   block10 : {
    block7 : {
     block8 : {
      block9 : {
       $2_1 = HEAP32[($5_1 + 4 | 0) >> 2] | 0;
       if (!($2_1 & 2 | 0)) {
        if ((HEAP32[290868 >> 2] | 0 | 0) == ($5_1 | 0)) {
         HEAP32[290868 >> 2] = $0_1;
         $1_1 = (HEAP32[290856 >> 2] | 0) + $1_1 | 0;
         HEAP32[290856 >> 2] = $1_1;
         HEAP32[($0_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
         if (($0_1 | 0) != (HEAP32[290864 >> 2] | 0 | 0)) {
          break block1
         }
         HEAP32[290852 >> 2] = 0;
         HEAP32[290864 >> 2] = 0;
         return;
        }
        $8_1 = HEAP32[290864 >> 2] | 0;
        if (($8_1 | 0) == ($5_1 | 0)) {
         HEAP32[290864 >> 2] = $0_1;
         $1_1 = (HEAP32[290852 >> 2] | 0) + $1_1 | 0;
         HEAP32[290852 >> 2] = $1_1;
         HEAP32[($0_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
         HEAP32[($0_1 + $1_1 | 0) >> 2] = $1_1;
         return;
        }
        $1_1 = ($2_1 & -8 | 0) + $1_1 | 0;
        $3_1 = HEAP32[($5_1 + 12 | 0) >> 2] | 0;
        if ($2_1 >>> 0 <= 255 >>> 0) {
         $4_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
         if (($4_1 | 0) == ($3_1 | 0)) {
          HEAP32[290844 >> 2] = (HEAP32[290844 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $2_1 >>> 3 | 0 | 0) | 0) | 0;
          break block7;
         }
         HEAP32[($3_1 + 8 | 0) >> 2] = $4_1;
         HEAP32[($4_1 + 12 | 0) >> 2] = $3_1;
         break block7;
        }
        $6_1 = HEAP32[($5_1 + 24 | 0) >> 2] | 0;
        if (($3_1 | 0) != ($5_1 | 0)) {
         $2_1 = HEAP32[($5_1 + 8 | 0) >> 2] | 0;
         HEAP32[($2_1 + 12 | 0) >> 2] = $3_1;
         HEAP32[($3_1 + 8 | 0) >> 2] = $2_1;
         break block8;
        }
        $4_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
        if ($4_1) {
         $227 = $5_1 + 20 | 0
        } else {
         $4_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
         if (!$4_1) {
          break block9
         }
         $227 = $5_1 + 16 | 0;
        }
        $2_1 = $227;
        label1 : while (1) {
         $7_1 = $2_1;
         $3_1 = $4_1;
         $2_1 = $3_1 + 20 | 0;
         $4_1 = HEAP32[($3_1 + 20 | 0) >> 2] | 0;
         if ($4_1) {
          continue label1
         }
         $2_1 = $3_1 + 16 | 0;
         $4_1 = HEAP32[($3_1 + 16 | 0) >> 2] | 0;
         if ($4_1) {
          continue label1
         }
         break label1;
        };
        HEAP32[$7_1 >> 2] = 0;
        break block8;
       }
       HEAP32[($5_1 + 4 | 0) >> 2] = $2_1 & -2 | 0;
       HEAP32[($0_1 + $1_1 | 0) >> 2] = $1_1;
       HEAP32[($0_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
       break block10;
      }
      $3_1 = 0;
     }
     if (!$6_1) {
      break block7
     }
     block11 : {
      $2_1 = HEAP32[($5_1 + 28 | 0) >> 2] | 0;
      $4_1 = $2_1 << 2 | 0;
      if ((HEAP32[($4_1 + 291148 | 0) >> 2] | 0 | 0) == ($5_1 | 0)) {
       HEAP32[($4_1 + 291148 | 0) >> 2] = $3_1;
       if ($3_1) {
        break block11
       }
       HEAP32[290848 >> 2] = (HEAP32[290848 >> 2] | 0) & (__wasm_rotl_i32(-2 | 0, $2_1 | 0) | 0) | 0;
       break block7;
      }
      block12 : {
       if (($5_1 | 0) == (HEAP32[($6_1 + 16 | 0) >> 2] | 0 | 0)) {
        HEAP32[($6_1 + 16 | 0) >> 2] = $3_1;
        break block12;
       }
       HEAP32[($6_1 + 20 | 0) >> 2] = $3_1;
      }
      if (!$3_1) {
       break block7
      }
     }
     HEAP32[($3_1 + 24 | 0) >> 2] = $6_1;
     $2_1 = HEAP32[($5_1 + 16 | 0) >> 2] | 0;
     if ($2_1) {
      HEAP32[($3_1 + 16 | 0) >> 2] = $2_1;
      HEAP32[($2_1 + 24 | 0) >> 2] = $3_1;
     }
     $2_1 = HEAP32[($5_1 + 20 | 0) >> 2] | 0;
     if (!$2_1) {
      break block7
     }
     HEAP32[($3_1 + 20 | 0) >> 2] = $2_1;
     HEAP32[($2_1 + 24 | 0) >> 2] = $3_1;
    }
    HEAP32[($0_1 + $1_1 | 0) >> 2] = $1_1;
    HEAP32[($0_1 + 4 | 0) >> 2] = $1_1 | 1 | 0;
    if (($0_1 | 0) != ($8_1 | 0)) {
     break block10
    }
    HEAP32[290852 >> 2] = $1_1;
    return;
   }
   if ($1_1 >>> 0 <= 255 >>> 0) {
    $2_1 = ($1_1 & 248 | 0) + 290884 | 0;
    block13 : {
     $3_1 = HEAP32[290844 >> 2] | 0;
     $1_1 = 1 << ($1_1 >>> 3 | 0) | 0;
     if (!($3_1 & $1_1 | 0)) {
      HEAP32[290844 >> 2] = $1_1 | $3_1 | 0;
      $325 = $2_1;
      break block13;
     }
     $325 = HEAP32[($2_1 + 8 | 0) >> 2] | 0;
    }
    $1_1 = $325;
    HEAP32[($1_1 + 12 | 0) >> 2] = $0_1;
    HEAP32[($2_1 + 8 | 0) >> 2] = $0_1;
    HEAP32[($0_1 + 12 | 0) >> 2] = $2_1;
    HEAP32[($0_1 + 8 | 0) >> 2] = $1_1;
    return;
   }
   $3_1 = 31;
   if ($1_1 >>> 0 <= 16777215 >>> 0) {
    $2_1 = Math_clz32($1_1 >>> 8 | 0);
    $3_1 = (($1_1 >>> (38 - $2_1 | 0) | 0) & 1 | 0 | ($2_1 << 1 | 0) | 0) ^ 62 | 0;
   }
   HEAP32[($0_1 + 28 | 0) >> 2] = $3_1;
   HEAP32[($0_1 + 16 | 0) >> 2] = 0;
   HEAP32[($0_1 + 20 | 0) >> 2] = 0;
   $2_1 = ($3_1 << 2 | 0) + 291148 | 0;
   $4_1 = HEAP32[290848 >> 2] | 0;
   $7_1 = 1 << $3_1 | 0;
   if (!($4_1 & $7_1 | 0)) {
    HEAP32[$2_1 >> 2] = $0_1;
    HEAP32[290848 >> 2] = $4_1 | $7_1 | 0;
    HEAP32[($0_1 + 24 | 0) >> 2] = $2_1;
    HEAP32[($0_1 + 8 | 0) >> 2] = $0_1;
    HEAP32[($0_1 + 12 | 0) >> 2] = $0_1;
    return;
   }
   $3_1 = $1_1 << (($3_1 | 0) != (31 | 0) ? 25 - ($3_1 >>> 1 | 0) | 0 : 0) | 0;
   $2_1 = HEAP32[$2_1 >> 2] | 0;
   block14 : {
    label2 : while (1) {
     $4_1 = $2_1;
     if (((HEAP32[($2_1 + 4 | 0) >> 2] | 0) & -8 | 0 | 0) == ($1_1 | 0)) {
      break block14
     }
     $2_1 = $3_1 >>> 29 | 0;
     $3_1 = $3_1 << 1 | 0;
     $7_1 = $4_1 + ($2_1 & 4 | 0) | 0;
     $2_1 = HEAP32[($7_1 + 16 | 0) >> 2] | 0;
     if ($2_1) {
      continue label2
     }
     break label2;
    };
    HEAP32[($7_1 + 16 | 0) >> 2] = $0_1;
    HEAP32[($0_1 + 24 | 0) >> 2] = $4_1;
    HEAP32[($0_1 + 12 | 0) >> 2] = $0_1;
    HEAP32[($0_1 + 8 | 0) >> 2] = $0_1;
    return;
   }
   $1_1 = HEAP32[($4_1 + 8 | 0) >> 2] | 0;
   HEAP32[($1_1 + 12 | 0) >> 2] = $0_1;
   HEAP32[($4_1 + 8 | 0) >> 2] = $0_1;
   HEAP32[($0_1 + 24 | 0) >> 2] = 0;
   HEAP32[($0_1 + 12 | 0) >> 2] = $4_1;
   HEAP32[($0_1 + 8 | 0) >> 2] = $1_1;
  }
 }
 
 function $41($0_1, $1_1, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $2_1 = $2_1 | 0;
  var $3_1 = 0, $27_1 = 0, $4_1 = 0;
  $3_1 = __wasm_memory_size() << 16 | 0;
  if ($3_1 >>> 0 < ($0_1 + $2_1 | 0) >>> 0 | ($1_1 + $2_1 | 0) >>> 0 > $3_1 >>> 0 | 0) {
   wasm2js_trap()
  }
  if ($0_1 >>> 0 > $1_1 >>> 0) {
   $3_1 = $2_1 - 1 | 0;
   $2_1 = -1;
   $27_1 = -1;
  } else {
   $3_1 = 0;
   $27_1 = 1;
  }
  $4_1 = $27_1;
  label : while (1) {
   if (!(($2_1 | 0) == ($3_1 | 0))) {
    HEAP8[($0_1 + $3_1 | 0) >> 0] = HEAPU8[($1_1 + $3_1 | 0) >> 0] | 0;
    $3_1 = $3_1 + $4_1 | 0;
    continue label;
   }
   break label;
  };
 }
 
 function $42($0_1, $1_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  if (($0_1 + $1_1 | 0) >>> 0 > (__wasm_memory_size() << 16 | 0) >>> 0) {
   wasm2js_trap()
  }
  label : while (1) {
   if ($1_1) {
    $1_1 = $1_1 - 1 | 0;
    HEAP8[($1_1 + $0_1 | 0) >> 0] = 0;
    continue label;
   }
   break label;
  };
 }
 
 function legalfunc$fimport$2($0_1, $1_1, $1$hi, $2_1) {
  $0_1 = $0_1 | 0;
  $1_1 = $1_1 | 0;
  $1$hi = $1$hi | 0;
  $2_1 = $2_1 | 0;
  var i64toi32_i32$4 = 0, i64toi32_i32$0 = 0, i64toi32_i32$1 = 0, i64toi32_i32$3 = 0, $11_1 = 0, $3_1 = 0, $5_1 = 0, i64toi32_i32$2 = 0;
  $3_1 = $0_1;
  i64toi32_i32$0 = $1$hi;
  $5_1 = $1_1;
  i64toi32_i32$2 = $1_1;
  i64toi32_i32$1 = 0;
  i64toi32_i32$3 = 32;
  i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$1 = 0;
   $11_1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
  } else {
   i64toi32_i32$1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
   $11_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
  }
  return legalimport$fimport$2($3_1 | 0, $5_1 | 0, $11_1 | 0, $2_1 | 0) | 0 | 0;
 }
 
 function _ZN17compiler_builtins3int3mul3Mul3mul17h070e9a1c69faec5bE(var$0, var$0$hi, var$1, var$1$hi) {
  var$0 = var$0 | 0;
  var$0$hi = var$0$hi | 0;
  var$1 = var$1 | 0;
  var$1$hi = var$1$hi | 0;
  var i64toi32_i32$4 = 0, i64toi32_i32$0 = 0, i64toi32_i32$1 = 0, var$2 = 0, i64toi32_i32$2 = 0, i64toi32_i32$3 = 0, var$3 = 0, var$4 = 0, var$5 = 0, $21_1 = 0, $22_1 = 0, var$6 = 0, $24_1 = 0, $17_1 = 0, $18_1 = 0, $23_1 = 0, $29_1 = 0, $45 = 0, $56$hi = 0, $62$hi = 0;
  i64toi32_i32$0 = var$1$hi;
  var$2 = var$1;
  var$4 = var$2 >>> 16 | 0;
  i64toi32_i32$0 = var$0$hi;
  var$3 = var$0;
  var$5 = var$3 >>> 16 | 0;
  $17_1 = Math_imul(var$4, var$5);
  $18_1 = var$2;
  i64toi32_i32$2 = var$3;
  i64toi32_i32$1 = 0;
  i64toi32_i32$3 = 32;
  i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$1 = 0;
   $21_1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
  } else {
   i64toi32_i32$1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
   $21_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
  }
  $23_1 = $17_1 + Math_imul($18_1, $21_1) | 0;
  i64toi32_i32$1 = var$1$hi;
  i64toi32_i32$0 = var$1;
  i64toi32_i32$2 = 0;
  i64toi32_i32$3 = 32;
  i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$2 = 0;
   $22_1 = i64toi32_i32$1 >>> i64toi32_i32$4 | 0;
  } else {
   i64toi32_i32$2 = i64toi32_i32$1 >>> i64toi32_i32$4 | 0;
   $22_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$1 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$0 >>> i64toi32_i32$4 | 0) | 0;
  }
  $29_1 = $23_1 + Math_imul($22_1, var$3) | 0;
  var$2 = var$2 & 65535 | 0;
  var$3 = var$3 & 65535 | 0;
  var$6 = Math_imul(var$2, var$3);
  var$2 = (var$6 >>> 16 | 0) + Math_imul(var$2, var$5) | 0;
  $45 = $29_1 + (var$2 >>> 16 | 0) | 0;
  var$2 = (var$2 & 65535 | 0) + Math_imul(var$4, var$3) | 0;
  i64toi32_i32$2 = 0;
  i64toi32_i32$1 = $45 + (var$2 >>> 16 | 0) | 0;
  i64toi32_i32$0 = 0;
  i64toi32_i32$3 = 32;
  i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$0 = i64toi32_i32$1 << i64toi32_i32$4 | 0;
   $24_1 = 0;
  } else {
   i64toi32_i32$0 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$1 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$2 << i64toi32_i32$4 | 0) | 0;
   $24_1 = i64toi32_i32$1 << i64toi32_i32$4 | 0;
  }
  $56$hi = i64toi32_i32$0;
  i64toi32_i32$0 = 0;
  $62$hi = i64toi32_i32$0;
  i64toi32_i32$0 = $56$hi;
  i64toi32_i32$2 = $24_1;
  i64toi32_i32$1 = $62$hi;
  i64toi32_i32$3 = var$2 << 16 | 0 | (var$6 & 65535 | 0) | 0;
  i64toi32_i32$1 = i64toi32_i32$0 | i64toi32_i32$1 | 0;
  i64toi32_i32$2 = i64toi32_i32$2 | i64toi32_i32$3 | 0;
  i64toi32_i32$HIGH_BITS = i64toi32_i32$1;
  return i64toi32_i32$2 | 0;
 }
 
 function _ZN17compiler_builtins3int4sdiv3Div3div17he78fc483e41d7ec7E(var$0, var$0$hi, var$1, var$1$hi) {
  var$0 = var$0 | 0;
  var$0$hi = var$0$hi | 0;
  var$1 = var$1 | 0;
  var$1$hi = var$1$hi | 0;
  var i64toi32_i32$1 = 0, i64toi32_i32$2 = 0, i64toi32_i32$4 = 0, i64toi32_i32$3 = 0, i64toi32_i32$0 = 0, i64toi32_i32$5 = 0, var$2 = 0, var$2$hi = 0, i64toi32_i32$6 = 0, $21_1 = 0, $22_1 = 0, $23_1 = 0, $7$hi = 0, $9_1 = 0, $9$hi = 0, $14$hi = 0, $16$hi = 0, $17_1 = 0, $17$hi = 0, $23$hi = 0;
  i64toi32_i32$0 = var$0$hi;
  i64toi32_i32$2 = var$0;
  i64toi32_i32$1 = 0;
  i64toi32_i32$3 = 63;
  i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$1 = i64toi32_i32$0 >> 31 | 0;
   $21_1 = i64toi32_i32$0 >> i64toi32_i32$4 | 0;
  } else {
   i64toi32_i32$1 = i64toi32_i32$0 >> i64toi32_i32$4 | 0;
   $21_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
  }
  var$2 = $21_1;
  var$2$hi = i64toi32_i32$1;
  i64toi32_i32$1 = var$0$hi;
  i64toi32_i32$1 = var$2$hi;
  i64toi32_i32$0 = var$2;
  i64toi32_i32$2 = var$0$hi;
  i64toi32_i32$3 = var$0;
  i64toi32_i32$2 = i64toi32_i32$1 ^ i64toi32_i32$2 | 0;
  $7$hi = i64toi32_i32$2;
  i64toi32_i32$2 = i64toi32_i32$1;
  i64toi32_i32$2 = $7$hi;
  i64toi32_i32$1 = i64toi32_i32$0 ^ i64toi32_i32$3 | 0;
  i64toi32_i32$0 = var$2$hi;
  i64toi32_i32$3 = var$2;
  i64toi32_i32$4 = i64toi32_i32$1 - i64toi32_i32$3 | 0;
  i64toi32_i32$6 = i64toi32_i32$1 >>> 0 < i64toi32_i32$3 >>> 0;
  i64toi32_i32$5 = i64toi32_i32$6 + i64toi32_i32$0 | 0;
  i64toi32_i32$5 = i64toi32_i32$2 - i64toi32_i32$5 | 0;
  $9_1 = i64toi32_i32$4;
  $9$hi = i64toi32_i32$5;
  i64toi32_i32$5 = var$1$hi;
  i64toi32_i32$2 = var$1;
  i64toi32_i32$1 = 0;
  i64toi32_i32$3 = 63;
  i64toi32_i32$0 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$1 = i64toi32_i32$5 >> 31 | 0;
   $22_1 = i64toi32_i32$5 >> i64toi32_i32$0 | 0;
  } else {
   i64toi32_i32$1 = i64toi32_i32$5 >> i64toi32_i32$0 | 0;
   $22_1 = (((1 << i64toi32_i32$0 | 0) - 1 | 0) & i64toi32_i32$5 | 0) << (32 - i64toi32_i32$0 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$0 | 0) | 0;
  }
  var$2 = $22_1;
  var$2$hi = i64toi32_i32$1;
  i64toi32_i32$1 = var$1$hi;
  i64toi32_i32$1 = var$2$hi;
  i64toi32_i32$5 = var$2;
  i64toi32_i32$2 = var$1$hi;
  i64toi32_i32$3 = var$1;
  i64toi32_i32$2 = i64toi32_i32$1 ^ i64toi32_i32$2 | 0;
  $14$hi = i64toi32_i32$2;
  i64toi32_i32$2 = i64toi32_i32$1;
  i64toi32_i32$2 = $14$hi;
  i64toi32_i32$1 = i64toi32_i32$5 ^ i64toi32_i32$3 | 0;
  i64toi32_i32$5 = var$2$hi;
  i64toi32_i32$3 = var$2;
  i64toi32_i32$0 = i64toi32_i32$1 - i64toi32_i32$3 | 0;
  i64toi32_i32$6 = i64toi32_i32$1 >>> 0 < i64toi32_i32$3 >>> 0;
  i64toi32_i32$4 = i64toi32_i32$6 + i64toi32_i32$5 | 0;
  i64toi32_i32$4 = i64toi32_i32$2 - i64toi32_i32$4 | 0;
  $16$hi = i64toi32_i32$4;
  i64toi32_i32$4 = $9$hi;
  i64toi32_i32$1 = $16$hi;
  i64toi32_i32$1 = __wasm_i64_udiv($9_1 | 0, i64toi32_i32$4 | 0, i64toi32_i32$0 | 0, i64toi32_i32$1 | 0) | 0;
  i64toi32_i32$4 = i64toi32_i32$HIGH_BITS;
  $17_1 = i64toi32_i32$1;
  $17$hi = i64toi32_i32$4;
  i64toi32_i32$4 = var$1$hi;
  i64toi32_i32$4 = var$0$hi;
  i64toi32_i32$4 = var$1$hi;
  i64toi32_i32$2 = var$1;
  i64toi32_i32$1 = var$0$hi;
  i64toi32_i32$3 = var$0;
  i64toi32_i32$1 = i64toi32_i32$4 ^ i64toi32_i32$1 | 0;
  i64toi32_i32$4 = i64toi32_i32$2 ^ i64toi32_i32$3 | 0;
  i64toi32_i32$2 = 0;
  i64toi32_i32$3 = 63;
  i64toi32_i32$5 = i64toi32_i32$3 & 31 | 0;
  if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
   i64toi32_i32$2 = i64toi32_i32$1 >> 31 | 0;
   $23_1 = i64toi32_i32$1 >> i64toi32_i32$5 | 0;
  } else {
   i64toi32_i32$2 = i64toi32_i32$1 >> i64toi32_i32$5 | 0;
   $23_1 = (((1 << i64toi32_i32$5 | 0) - 1 | 0) & i64toi32_i32$1 | 0) << (32 - i64toi32_i32$5 | 0) | 0 | (i64toi32_i32$4 >>> i64toi32_i32$5 | 0) | 0;
  }
  var$0 = $23_1;
  var$0$hi = i64toi32_i32$2;
  i64toi32_i32$2 = $17$hi;
  i64toi32_i32$1 = $17_1;
  i64toi32_i32$4 = var$0$hi;
  i64toi32_i32$3 = var$0;
  i64toi32_i32$4 = i64toi32_i32$2 ^ i64toi32_i32$4 | 0;
  $23$hi = i64toi32_i32$4;
  i64toi32_i32$4 = var$0$hi;
  i64toi32_i32$4 = $23$hi;
  i64toi32_i32$2 = i64toi32_i32$1 ^ i64toi32_i32$3 | 0;
  i64toi32_i32$1 = var$0$hi;
  i64toi32_i32$5 = i64toi32_i32$2 - i64toi32_i32$3 | 0;
  i64toi32_i32$6 = i64toi32_i32$2 >>> 0 < i64toi32_i32$3 >>> 0;
  i64toi32_i32$0 = i64toi32_i32$6 + i64toi32_i32$1 | 0;
  i64toi32_i32$0 = i64toi32_i32$4 - i64toi32_i32$0 | 0;
  i64toi32_i32$2 = i64toi32_i32$5;
  i64toi32_i32$HIGH_BITS = i64toi32_i32$0;
  return i64toi32_i32$2 | 0;
 }
 
 function _ZN17compiler_builtins3int4udiv10divmod_u6417h6026910b5ed08e40E(var$0, var$0$hi, var$1, var$1$hi) {
  var$0 = var$0 | 0;
  var$0$hi = var$0$hi | 0;
  var$1 = var$1 | 0;
  var$1$hi = var$1$hi | 0;
  var i64toi32_i32$2 = 0, i64toi32_i32$3 = 0, i64toi32_i32$4 = 0, i64toi32_i32$1 = 0, i64toi32_i32$0 = 0, i64toi32_i32$5 = 0, var$2 = 0, var$3 = 0, var$4 = 0, var$5 = 0, var$5$hi = 0, var$6 = 0, var$6$hi = 0, i64toi32_i32$6 = 0, $37_1 = 0, $38_1 = 0, $39_1 = 0, $40_1 = 0, $41_1 = 0, $42_1 = 0, $43 = 0, $44 = 0, var$8$hi = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, var$7$hi = 0, $49 = 0, $63$hi = 0, $65 = 0, $65$hi = 0, $120$hi = 0, $129$hi = 0, $134$hi = 0, var$8 = 0, $140 = 0, $140$hi = 0, $142$hi = 0, $144 = 0, $144$hi = 0, $151 = 0, $151$hi = 0, $154$hi = 0, var$7 = 0, $165$hi = 0;
  label$1 : {
   label$2 : {
    label$3 : {
     label$4 : {
      label$5 : {
       label$6 : {
        label$7 : {
         label$8 : {
          label$9 : {
           label$10 : {
            label$11 : {
             i64toi32_i32$0 = var$0$hi;
             i64toi32_i32$2 = var$0;
             i64toi32_i32$1 = 0;
             i64toi32_i32$3 = 32;
             i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
             if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
              i64toi32_i32$1 = 0;
              $37_1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
             } else {
              i64toi32_i32$1 = i64toi32_i32$0 >>> i64toi32_i32$4 | 0;
              $37_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$0 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
             }
             var$2 = $37_1;
             if (var$2) {
              i64toi32_i32$1 = var$1$hi;
              var$3 = var$1;
              if (!var$3) {
               break label$11
              }
              i64toi32_i32$0 = var$3;
              i64toi32_i32$2 = 0;
              i64toi32_i32$3 = 32;
              i64toi32_i32$4 = i64toi32_i32$3 & 31 | 0;
              if (32 >>> 0 <= (i64toi32_i32$3 & 63 | 0) >>> 0) {
               i64toi32_i32$2 = 0;
               $38_1 = i64toi32_i32$1 >>> i64toi32_i32$4 | 0;
              } else {
               i64toi32_i32$2 = i64toi32_i32$1 >>> i64toi32_i32$4 | 0;
               $38_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$1 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$0 >>> i64toi32_i32$4 | 0) | 0;
              }
              var$4 = $38_1;
              if (!var$4) {
               break label$9
              }
              var$2 = Math_clz32(var$4) - Math_clz32(var$2) | 0;
              if (var$2 >>> 0 <= 31 >>> 0) {
               break label$8
              }
              break label$2;
             }
             i64toi32_i32$2 = var$1$hi;
             i64toi32_i32$1 = var$1;
             i64toi32_i32$0 = 1;
             i64toi32_i32$3 = 0;
             if (i64toi32_i32$2 >>> 0 > i64toi32_i32$0 >>> 0 | ((i64toi32_i32$2 | 0) == (i64toi32_i32$0 | 0) & i64toi32_i32$1 >>> 0 >= i64toi32_i32$3 >>> 0 | 0) | 0) {
              break label$2
             }
             i64toi32_i32$1 = var$0$hi;
             var$2 = var$0;
             i64toi32_i32$1 = i64toi32_i32$2;
             i64toi32_i32$1 = i64toi32_i32$2;
             var$3 = var$1;
             var$2 = (var$2 >>> 0) / (var$3 >>> 0) | 0;
             i64toi32_i32$1 = 0;
             __wasm_intrinsics_temp_i64 = var$0 - Math_imul(var$2, var$3) | 0;
             __wasm_intrinsics_temp_i64$hi = i64toi32_i32$1;
             i64toi32_i32$1 = 0;
             i64toi32_i32$2 = var$2;
             i64toi32_i32$HIGH_BITS = i64toi32_i32$1;
             return i64toi32_i32$2 | 0;
            }
            i64toi32_i32$2 = var$1$hi;
            i64toi32_i32$3 = var$1;
            i64toi32_i32$1 = 0;
            i64toi32_i32$0 = 32;
            i64toi32_i32$4 = i64toi32_i32$0 & 31 | 0;
            if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
             i64toi32_i32$1 = 0;
             $39_1 = i64toi32_i32$2 >>> i64toi32_i32$4 | 0;
            } else {
             i64toi32_i32$1 = i64toi32_i32$2 >>> i64toi32_i32$4 | 0;
             $39_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$2 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$3 >>> i64toi32_i32$4 | 0) | 0;
            }
            var$3 = $39_1;
            i64toi32_i32$1 = var$0$hi;
            if (!var$0) {
             break label$7
            }
            if (!var$3) {
             break label$6
            }
            var$4 = var$3 + -1 | 0;
            if (var$4 & var$3 | 0) {
             break label$6
            }
            i64toi32_i32$1 = 0;
            i64toi32_i32$2 = var$4 & var$2 | 0;
            i64toi32_i32$3 = 0;
            i64toi32_i32$0 = 32;
            i64toi32_i32$4 = i64toi32_i32$0 & 31 | 0;
            if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
             i64toi32_i32$3 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
             $40_1 = 0;
            } else {
             i64toi32_i32$3 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$2 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$1 << i64toi32_i32$4 | 0) | 0;
             $40_1 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
            }
            $63$hi = i64toi32_i32$3;
            i64toi32_i32$3 = var$0$hi;
            i64toi32_i32$1 = var$0;
            i64toi32_i32$2 = 0;
            i64toi32_i32$0 = -1;
            i64toi32_i32$2 = i64toi32_i32$3 & i64toi32_i32$2 | 0;
            $65 = i64toi32_i32$1 & i64toi32_i32$0 | 0;
            $65$hi = i64toi32_i32$2;
            i64toi32_i32$2 = $63$hi;
            i64toi32_i32$3 = $40_1;
            i64toi32_i32$1 = $65$hi;
            i64toi32_i32$0 = $65;
            i64toi32_i32$1 = i64toi32_i32$2 | i64toi32_i32$1 | 0;
            __wasm_intrinsics_temp_i64 = i64toi32_i32$3 | i64toi32_i32$0 | 0;
            __wasm_intrinsics_temp_i64$hi = i64toi32_i32$1;
            i64toi32_i32$1 = 0;
            i64toi32_i32$3 = var$2 >>> ((__wasm_ctz_i32(var$3 | 0) | 0) & 31 | 0) | 0;
            i64toi32_i32$HIGH_BITS = i64toi32_i32$1;
            return i64toi32_i32$3 | 0;
           }
          }
          var$4 = var$3 + -1 | 0;
          if (!(var$4 & var$3 | 0)) {
           break label$5
          }
          var$2 = (Math_clz32(var$3) + 33 | 0) - Math_clz32(var$2) | 0;
          var$3 = 0 - var$2 | 0;
          break label$3;
         }
         var$3 = 63 - var$2 | 0;
         var$2 = var$2 + 1 | 0;
         break label$3;
        }
        var$4 = (var$2 >>> 0) / (var$3 >>> 0) | 0;
        i64toi32_i32$3 = 0;
        i64toi32_i32$2 = var$2 - Math_imul(var$4, var$3) | 0;
        i64toi32_i32$1 = 0;
        i64toi32_i32$0 = 32;
        i64toi32_i32$4 = i64toi32_i32$0 & 31 | 0;
        if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
         i64toi32_i32$1 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
         $41_1 = 0;
        } else {
         i64toi32_i32$1 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$2 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$3 << i64toi32_i32$4 | 0) | 0;
         $41_1 = i64toi32_i32$2 << i64toi32_i32$4 | 0;
        }
        __wasm_intrinsics_temp_i64 = $41_1;
        __wasm_intrinsics_temp_i64$hi = i64toi32_i32$1;
        i64toi32_i32$1 = 0;
        i64toi32_i32$2 = var$4;
        i64toi32_i32$HIGH_BITS = i64toi32_i32$1;
        return i64toi32_i32$2 | 0;
       }
       var$2 = Math_clz32(var$3) - Math_clz32(var$2) | 0;
       if (var$2 >>> 0 < 31 >>> 0) {
        break label$4
       }
       break label$2;
      }
      i64toi32_i32$2 = var$0$hi;
      i64toi32_i32$2 = 0;
      __wasm_intrinsics_temp_i64 = var$4 & var$0 | 0;
      __wasm_intrinsics_temp_i64$hi = i64toi32_i32$2;
      if ((var$3 | 0) == (1 | 0)) {
       break label$1
      }
      i64toi32_i32$2 = var$0$hi;
      i64toi32_i32$2 = 0;
      $120$hi = i64toi32_i32$2;
      i64toi32_i32$2 = var$0$hi;
      i64toi32_i32$3 = var$0;
      i64toi32_i32$1 = $120$hi;
      i64toi32_i32$0 = __wasm_ctz_i32(var$3 | 0) | 0;
      i64toi32_i32$4 = i64toi32_i32$0 & 31 | 0;
      if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
       i64toi32_i32$1 = 0;
       $42_1 = i64toi32_i32$2 >>> i64toi32_i32$4 | 0;
      } else {
       i64toi32_i32$1 = i64toi32_i32$2 >>> i64toi32_i32$4 | 0;
       $42_1 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$2 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$3 >>> i64toi32_i32$4 | 0) | 0;
      }
      i64toi32_i32$3 = $42_1;
      i64toi32_i32$HIGH_BITS = i64toi32_i32$1;
      return i64toi32_i32$3 | 0;
     }
     var$3 = 63 - var$2 | 0;
     var$2 = var$2 + 1 | 0;
    }
    i64toi32_i32$3 = var$0$hi;
    i64toi32_i32$3 = 0;
    $129$hi = i64toi32_i32$3;
    i64toi32_i32$3 = var$0$hi;
    i64toi32_i32$2 = var$0;
    i64toi32_i32$1 = $129$hi;
    i64toi32_i32$0 = var$2 & 63 | 0;
    i64toi32_i32$4 = i64toi32_i32$0 & 31 | 0;
    if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
     i64toi32_i32$1 = 0;
     $43 = i64toi32_i32$3 >>> i64toi32_i32$4 | 0;
    } else {
     i64toi32_i32$1 = i64toi32_i32$3 >>> i64toi32_i32$4 | 0;
     $43 = (((1 << i64toi32_i32$4 | 0) - 1 | 0) & i64toi32_i32$3 | 0) << (32 - i64toi32_i32$4 | 0) | 0 | (i64toi32_i32$2 >>> i64toi32_i32$4 | 0) | 0;
    }
    var$5 = $43;
    var$5$hi = i64toi32_i32$1;
    i64toi32_i32$1 = var$0$hi;
    i64toi32_i32$1 = 0;
    $134$hi = i64toi32_i32$1;
    i64toi32_i32$1 = var$0$hi;
    i64toi32_i32$3 = var$0;
    i64toi32_i32$2 = $134$hi;
    i64toi32_i32$0 = var$3 & 63 | 0;
    i64toi32_i32$4 = i64toi32_i32$0 & 31 | 0;
    if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
     i64toi32_i32$2 = i64toi32_i32$3 << i64toi32_i32$4 | 0;
     $44 = 0;
    } else {
     i64toi32_i32$2 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$3 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$1 << i64toi32_i32$4 | 0) | 0;
     $44 = i64toi32_i32$3 << i64toi32_i32$4 | 0;
    }
    var$0 = $44;
    var$0$hi = i64toi32_i32$2;
    label$13 : {
     if (var$2) {
      i64toi32_i32$2 = var$1$hi;
      i64toi32_i32$1 = var$1;
      i64toi32_i32$3 = -1;
      i64toi32_i32$0 = -1;
      i64toi32_i32$4 = i64toi32_i32$1 + i64toi32_i32$0 | 0;
      i64toi32_i32$5 = i64toi32_i32$2 + i64toi32_i32$3 | 0;
      if (i64toi32_i32$4 >>> 0 < i64toi32_i32$0 >>> 0) {
       i64toi32_i32$5 = i64toi32_i32$5 + 1 | 0
      }
      var$8 = i64toi32_i32$4;
      var$8$hi = i64toi32_i32$5;
      label$15 : while (1) {
       i64toi32_i32$5 = var$5$hi;
       i64toi32_i32$2 = var$5;
       i64toi32_i32$1 = 0;
       i64toi32_i32$0 = 1;
       i64toi32_i32$3 = i64toi32_i32$0 & 31 | 0;
       if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
        i64toi32_i32$1 = i64toi32_i32$2 << i64toi32_i32$3 | 0;
        $45 = 0;
       } else {
        i64toi32_i32$1 = ((1 << i64toi32_i32$3 | 0) - 1 | 0) & (i64toi32_i32$2 >>> (32 - i64toi32_i32$3 | 0) | 0) | 0 | (i64toi32_i32$5 << i64toi32_i32$3 | 0) | 0;
        $45 = i64toi32_i32$2 << i64toi32_i32$3 | 0;
       }
       $140 = $45;
       $140$hi = i64toi32_i32$1;
       i64toi32_i32$1 = var$0$hi;
       i64toi32_i32$5 = var$0;
       i64toi32_i32$2 = 0;
       i64toi32_i32$0 = 63;
       i64toi32_i32$3 = i64toi32_i32$0 & 31 | 0;
       if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
        i64toi32_i32$2 = 0;
        $46 = i64toi32_i32$1 >>> i64toi32_i32$3 | 0;
       } else {
        i64toi32_i32$2 = i64toi32_i32$1 >>> i64toi32_i32$3 | 0;
        $46 = (((1 << i64toi32_i32$3 | 0) - 1 | 0) & i64toi32_i32$1 | 0) << (32 - i64toi32_i32$3 | 0) | 0 | (i64toi32_i32$5 >>> i64toi32_i32$3 | 0) | 0;
       }
       $142$hi = i64toi32_i32$2;
       i64toi32_i32$2 = $140$hi;
       i64toi32_i32$1 = $140;
       i64toi32_i32$5 = $142$hi;
       i64toi32_i32$0 = $46;
       i64toi32_i32$5 = i64toi32_i32$2 | i64toi32_i32$5 | 0;
       var$5 = i64toi32_i32$1 | i64toi32_i32$0 | 0;
       var$5$hi = i64toi32_i32$5;
       $144 = var$5;
       $144$hi = i64toi32_i32$5;
       i64toi32_i32$5 = var$8$hi;
       i64toi32_i32$5 = var$5$hi;
       i64toi32_i32$5 = var$8$hi;
       i64toi32_i32$2 = var$8;
       i64toi32_i32$1 = var$5$hi;
       i64toi32_i32$0 = var$5;
       i64toi32_i32$3 = i64toi32_i32$2 - i64toi32_i32$0 | 0;
       i64toi32_i32$6 = i64toi32_i32$2 >>> 0 < i64toi32_i32$0 >>> 0;
       i64toi32_i32$4 = i64toi32_i32$6 + i64toi32_i32$1 | 0;
       i64toi32_i32$4 = i64toi32_i32$5 - i64toi32_i32$4 | 0;
       i64toi32_i32$5 = i64toi32_i32$3;
       i64toi32_i32$2 = 0;
       i64toi32_i32$0 = 63;
       i64toi32_i32$1 = i64toi32_i32$0 & 31 | 0;
       if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
        i64toi32_i32$2 = i64toi32_i32$4 >> 31 | 0;
        $47 = i64toi32_i32$4 >> i64toi32_i32$1 | 0;
       } else {
        i64toi32_i32$2 = i64toi32_i32$4 >> i64toi32_i32$1 | 0;
        $47 = (((1 << i64toi32_i32$1 | 0) - 1 | 0) & i64toi32_i32$4 | 0) << (32 - i64toi32_i32$1 | 0) | 0 | (i64toi32_i32$5 >>> i64toi32_i32$1 | 0) | 0;
       }
       var$6 = $47;
       var$6$hi = i64toi32_i32$2;
       i64toi32_i32$2 = var$1$hi;
       i64toi32_i32$2 = var$6$hi;
       i64toi32_i32$4 = var$6;
       i64toi32_i32$5 = var$1$hi;
       i64toi32_i32$0 = var$1;
       i64toi32_i32$5 = i64toi32_i32$2 & i64toi32_i32$5 | 0;
       $151 = i64toi32_i32$4 & i64toi32_i32$0 | 0;
       $151$hi = i64toi32_i32$5;
       i64toi32_i32$5 = $144$hi;
       i64toi32_i32$2 = $144;
       i64toi32_i32$4 = $151$hi;
       i64toi32_i32$0 = $151;
       i64toi32_i32$1 = i64toi32_i32$2 - i64toi32_i32$0 | 0;
       i64toi32_i32$6 = i64toi32_i32$2 >>> 0 < i64toi32_i32$0 >>> 0;
       i64toi32_i32$3 = i64toi32_i32$6 + i64toi32_i32$4 | 0;
       i64toi32_i32$3 = i64toi32_i32$5 - i64toi32_i32$3 | 0;
       var$5 = i64toi32_i32$1;
       var$5$hi = i64toi32_i32$3;
       i64toi32_i32$3 = var$0$hi;
       i64toi32_i32$5 = var$0;
       i64toi32_i32$2 = 0;
       i64toi32_i32$0 = 1;
       i64toi32_i32$4 = i64toi32_i32$0 & 31 | 0;
       if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
        i64toi32_i32$2 = i64toi32_i32$5 << i64toi32_i32$4 | 0;
        $48 = 0;
       } else {
        i64toi32_i32$2 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$5 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$3 << i64toi32_i32$4 | 0) | 0;
        $48 = i64toi32_i32$5 << i64toi32_i32$4 | 0;
       }
       $154$hi = i64toi32_i32$2;
       i64toi32_i32$2 = var$7$hi;
       i64toi32_i32$2 = $154$hi;
       i64toi32_i32$3 = $48;
       i64toi32_i32$5 = var$7$hi;
       i64toi32_i32$0 = var$7;
       i64toi32_i32$5 = i64toi32_i32$2 | i64toi32_i32$5 | 0;
       var$0 = i64toi32_i32$3 | i64toi32_i32$0 | 0;
       var$0$hi = i64toi32_i32$5;
       i64toi32_i32$5 = var$6$hi;
       i64toi32_i32$2 = var$6;
       i64toi32_i32$3 = 0;
       i64toi32_i32$0 = 1;
       i64toi32_i32$3 = i64toi32_i32$5 & i64toi32_i32$3 | 0;
       var$6 = i64toi32_i32$2 & i64toi32_i32$0 | 0;
       var$6$hi = i64toi32_i32$3;
       var$7 = var$6;
       var$7$hi = i64toi32_i32$3;
       var$2 = var$2 + -1 | 0;
       if (var$2) {
        continue label$15
       }
       break label$15;
      };
      break label$13;
     }
    }
    i64toi32_i32$3 = var$5$hi;
    __wasm_intrinsics_temp_i64 = var$5;
    __wasm_intrinsics_temp_i64$hi = i64toi32_i32$3;
    i64toi32_i32$3 = var$0$hi;
    i64toi32_i32$5 = var$0;
    i64toi32_i32$2 = 0;
    i64toi32_i32$0 = 1;
    i64toi32_i32$4 = i64toi32_i32$0 & 31 | 0;
    if (32 >>> 0 <= (i64toi32_i32$0 & 63 | 0) >>> 0) {
     i64toi32_i32$2 = i64toi32_i32$5 << i64toi32_i32$4 | 0;
     $49 = 0;
    } else {
     i64toi32_i32$2 = ((1 << i64toi32_i32$4 | 0) - 1 | 0) & (i64toi32_i32$5 >>> (32 - i64toi32_i32$4 | 0) | 0) | 0 | (i64toi32_i32$3 << i64toi32_i32$4 | 0) | 0;
     $49 = i64toi32_i32$5 << i64toi32_i32$4 | 0;
    }
    $165$hi = i64toi32_i32$2;
    i64toi32_i32$2 = var$6$hi;
    i64toi32_i32$2 = $165$hi;
    i64toi32_i32$3 = $49;
    i64toi32_i32$5 = var$6$hi;
    i64toi32_i32$0 = var$6;
    i64toi32_i32$5 = i64toi32_i32$2 | i64toi32_i32$5 | 0;
    i64toi32_i32$3 = i64toi32_i32$3 | i64toi32_i32$0 | 0;
    i64toi32_i32$HIGH_BITS = i64toi32_i32$5;
    return i64toi32_i32$3 | 0;
   }
   i64toi32_i32$3 = var$0$hi;
   __wasm_intrinsics_temp_i64 = var$0;
   __wasm_intrinsics_temp_i64$hi = i64toi32_i32$3;
   i64toi32_i32$3 = 0;
   var$0 = 0;
   var$0$hi = i64toi32_i32$3;
  }
  i64toi32_i32$3 = var$0$hi;
  i64toi32_i32$5 = var$0;
  i64toi32_i32$HIGH_BITS = i64toi32_i32$3;
  return i64toi32_i32$5 | 0;
 }
 
 function __wasm_ctz_i32(var$0) {
  var$0 = var$0 | 0;
  if (var$0) {
   return 31 - Math_clz32((var$0 + -1 | 0) ^ var$0 | 0) | 0 | 0
  }
  return 32 | 0;
 }
 
 function __wasm_i64_mul(var$0, var$0$hi, var$1, var$1$hi) {
  var$0 = var$0 | 0;
  var$0$hi = var$0$hi | 0;
  var$1 = var$1 | 0;
  var$1$hi = var$1$hi | 0;
  var i64toi32_i32$0 = 0, i64toi32_i32$1 = 0;
  i64toi32_i32$0 = var$0$hi;
  i64toi32_i32$0 = var$1$hi;
  i64toi32_i32$0 = var$0$hi;
  i64toi32_i32$1 = var$1$hi;
  i64toi32_i32$1 = _ZN17compiler_builtins3int3mul3Mul3mul17h070e9a1c69faec5bE(var$0 | 0, i64toi32_i32$0 | 0, var$1 | 0, i64toi32_i32$1 | 0) | 0;
  i64toi32_i32$0 = i64toi32_i32$HIGH_BITS;
  i64toi32_i32$HIGH_BITS = i64toi32_i32$0;
  return i64toi32_i32$1 | 0;
 }
 
 function __wasm_i64_sdiv(var$0, var$0$hi, var$1, var$1$hi) {
  var$0 = var$0 | 0;
  var$0$hi = var$0$hi | 0;
  var$1 = var$1 | 0;
  var$1$hi = var$1$hi | 0;
  var i64toi32_i32$0 = 0, i64toi32_i32$1 = 0;
  i64toi32_i32$0 = var$0$hi;
  i64toi32_i32$0 = var$1$hi;
  i64toi32_i32$0 = var$0$hi;
  i64toi32_i32$1 = var$1$hi;
  i64toi32_i32$1 = _ZN17compiler_builtins3int4sdiv3Div3div17he78fc483e41d7ec7E(var$0 | 0, i64toi32_i32$0 | 0, var$1 | 0, i64toi32_i32$1 | 0) | 0;
  i64toi32_i32$0 = i64toi32_i32$HIGH_BITS;
  i64toi32_i32$HIGH_BITS = i64toi32_i32$0;
  return i64toi32_i32$1 | 0;
 }
 
 function __wasm_i64_udiv(var$0, var$0$hi, var$1, var$1$hi) {
  var$0 = var$0 | 0;
  var$0$hi = var$0$hi | 0;
  var$1 = var$1 | 0;
  var$1$hi = var$1$hi | 0;
  var i64toi32_i32$0 = 0, i64toi32_i32$1 = 0;
  i64toi32_i32$0 = var$0$hi;
  i64toi32_i32$0 = var$1$hi;
  i64toi32_i32$0 = var$0$hi;
  i64toi32_i32$1 = var$1$hi;
  i64toi32_i32$1 = _ZN17compiler_builtins3int4udiv10divmod_u6417h6026910b5ed08e40E(var$0 | 0, i64toi32_i32$0 | 0, var$1 | 0, i64toi32_i32$1 | 0) | 0;
  i64toi32_i32$0 = i64toi32_i32$HIGH_BITS;
  i64toi32_i32$HIGH_BITS = i64toi32_i32$0;
  return i64toi32_i32$1 | 0;
 }
 
 function __wasm_rotl_i32(var$0, var$1) {
  var$0 = var$0 | 0;
  var$1 = var$1 | 0;
  var var$2 = 0;
  var$2 = var$1 & 31 | 0;
  var$1 = (0 - var$1 | 0) & 31 | 0;
  return ((-1 >>> var$2 | 0) & var$0 | 0) << var$2 | 0 | (((-1 << var$1 | 0) & var$0 | 0) >>> var$1 | 0) | 0 | 0;
 }
 
 bufferView = HEAPU8;
 initActiveSegments(imports);
 var FUNCTION_TABLE = [null, $7, $6, $8, $10, $16, $17, $18, $19, $20, $21, $25, $26];
 function __wasm_memory_size() {
  return buffer.byteLength >> 16;
 }
 
 return {
  "memory": Object.create(Object.prototype, {
   "grow": {
    
   }, 
   "buffer": {
    "get": function () {
     return buffer;
    }
    
   }
  }), 
  "_initialize": $0, 
  "free": $3, 
  "malloc": $22, 
  "tiplay_create": $28, 
  "tiplay_process": $31, 
  "tiplay_input_done": $32, 
  "tiplay_output_done": $33, 
  "tiplay_ratio": $34, 
  "tiplay_delete": $35
 };
}


const wasi_snapshot_preview1 = {
 random_get: () => 52, // ENOSYS: libc uses its non-cryptographic stack-guard fallback.
 environ_get: () => 0,
 environ_sizes_get: (count, size) => { const heap = new Int32Array(bufferView.buffer); heap[count >> 2] = 0; heap[size >> 2] = 0; return 0; },
 clock_time_get: (_clock, _low, _high, pointer) => { new Uint8Array(bufferView.buffer, pointer, 8).fill(0); return 0; },
 proc_exit: code => { throw new Error(`libsoxr exited (${code})`); }
};
const api = asmFunc({ wasi_snapshot_preview1 });
api._initialize();
const module = { exports: api };
for (const name of ['tiplay_create', 'tiplay_process', 'tiplay_ratio', 'tiplay_input_done', 'tiplay_output_done', 'tiplay_delete', 'malloc', 'free']) module['_' + name] = api[name];
module.HEAPU8 = new Uint8Array(api.memory.buffer);
module.HEAPF32 = new Float32Array(api.memory.buffer);
return module;
}
