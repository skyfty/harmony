import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { SceneNode, SceneNodeComponentState, RoadDynamicMesh } from './index'

import type { RigidbodyComponentProps, RigidbodyPhysicsShape } from './components'
import { BOUNDARY_WALL_COMPONENT_TYPE, clampBoundaryWallComponentProps, type BoundaryWallComponentProps } from './components'
import { ROAD_COMPONENT_TYPE, clampRoadProps, type RoadComponentProps } from './components/definitions/roadComponent'
import { resolveRoadLocalHeightSampler, createSegmentHeightSampler } from './roadMesh'
import { buildRoadCornerBezierCurvePath } from './roadCurvePath'
import { buildRoadGraph, type RoadGraph } from './roadGraph'

export type RoadHeightfieldBodiesEntry = { signature: string; bodies: CANNON.Body[] }

export type RoadHeightfieldTileDescriptor = {
	curveIndex: number
	tileIndex: number
	startIndex: number
	endIndex: number
	position: [number, number, number]
	yaw: number
	shapeDefinition: RigidbodyPhysicsShape
}

export type RoadHeightfieldBuildSnapshot = {
	surfaceNode: SceneNode
	tiles: RoadHeightfieldTileDescriptor[]
	heightHash: number
	layoutHash: number
	roadWidth: number
	collisionWidth: number
	samplingDensityFactor: number
	smoothingStrengthFactor: number
	minClearance: number
	junctionSmoothing: number
	desiredTileLength: number
	elementSize: number
	boundaryWallEnabled: boolean
	boundaryWallProps: BoundaryWallComponentProps | null
}

export type RoadHeightfieldBuildParams = {
	roadNode: SceneNode
	rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>
	roadObject: THREE.Object3D
	groundNode?: SceneNode | null
	world: CANNON.World
	createBody: (
		node: SceneNode,
		component: SceneNodeComponentState<RigidbodyComponentProps>,
		shapeDefinition: RigidbodyPhysicsShape | null,
		object: THREE.Object3D,
	) => { body: CANNON.Body } | null
	maxSegments?: number
}
	// RoadHeightfieldBuildParams: 闂傚倸鍊风粈渚€骞栭锔绘晞闁告侗鍨崑鎾愁潩閻撳骸顫紓浣介哺閹瑰洭鐛Ο鑲╃＜婵☆垳鍘ф慨鎼佹⒒娴ｇ瓔娼愰柛搴″暱閿曘垽鏌嗗鍡椾簻闂佸憡渚楅崢娆撳籍閸繄锛滃┑鐐寸暘閸╁嫭绂嶉悙鍝勭劦妞ゆ帒鍠氬鎰攽閻愯宸ラ柣锝囧厴閹粓鎳為妷銉㈠亾缂佹ü绻嗘い鏍ㄧ懆椤掔喖鏌￠崱顓犵瘈婵﹤顭峰畷鎺戭潩椤撶媭妲洪梻浣侯焾椤戝棝骞戦崶顒€钃熸繛鎴炃氶弸搴ㄧ叓閸ャ劍灏ㄩ柛瀣崄閵囨劙骞掗幋鐐剁发闂備胶绮弻銊╁触鐎ｎ喖纾跨€广儱顦伴悡鏇㈡煛閸ャ儱濡肩€殿喓鍔嶉妵鍕敃椤掑倻鏆ら梺鍝勬湰閻╊垱淇婇幖浣肝ㄦい鏃傚帶婢瑰牓姊绘担椋庝覆缂佹彃娼″畷鎴﹀箻閸撲胶鐓撴繝鐢靛Т閸燁偆娆㈤悙鐑樼厱妞ゆ劧缍€婢规ê霉?
	// - roadNode: 闂傚倸鍊风欢姘焽缂佹ü绻嗛柛銉墮绾惧潡鏌曢崼婵囧櫝闁哄绉电换娑㈠幢濡搫顫庨梺宕囩帛濮婂綊濡甸崟顖氱閻犺櫣娲呴敐澶嬬厽闁挎繂顦幉鐐叏婵犲啯銇濇い銏☆殕閹峰懘鎮烽幍顕嗙礆闂傚倷鐒﹀鍧楀矗閸愵亞涓嶉柡宥庡幖缁犵娀鏌ｉ幇顒佹儓缁炬儳鍚嬬换婵囩節閸屾碍娈ㄩ梺鍛婄墬閻楃姴顫忓ú顏勭閹艰揪绲哄Σ鍫ユ⒑閸忓吋銇熼柛銊﹀▕閸┾偓妞ゆ巻鍋撻柣蹇斿哺閺佸啴濮€閻樺灚娈鹃梺闈涱槴閺呪晠寮崘顔界厪闊洦娲栭～鎴炰繆閵堝懏鍣洪柣鎾寸懄閵囧嫰骞嬮敐鍛Х闂佺绻愰惉鑲╂閹炬剚鍚嬮柛婊€鐒﹂埢鍫ユ倵濞堝灝鏋欑紒顔界懇楠炲﹪寮介鐐靛幐闂佸憡鍔忛弲婊堝磿椤栨埃鏀介柣鎴濇川閸掔増绻涢懠顒€鈻堢€规洘绮岄埞鎴﹀炊瑜滈崵?
	// - rigidbodyComponent: 闂傚倸鍊搁崐椋庢閿熺姴绀堟慨妯挎硾缁犳彃銆掑锝呬壕闂佽鍨伴張顒勫Χ閿濆绀冮柍杞扮劍閻ゅ懘姊绘担渚劸闁哄牜鍓涢崚鎺斾沪閸撗屾祫濡炪倖鐗滈崑鐐哄磹閻㈠憡鐓熼柕蹇曞Х娴犳盯鏌涢妶鍌氫壕缂傚倸鍊烽梽宥夊礉瀹ュ鍋傞柨鐔哄Т缁犳岸鏌涢幇闈涙灈缂佲偓鐎ｎ偁浜滈柟鎵虫櫅閻忣喖霉閻橆偅娅嗙紒缁樼⊕濞煎繘宕滆钃遍梻浣告贡椤牊鏅舵禒瀣闁圭儤鍩堥崥瀣煕閳╁啰鎳愭繛鏉戝濮婃椽宕ㄦ繝鍐ㄧ煯缂備讲鍋撳ù锝堟閹冲懘姊婚崒娆愮グ妞ゆ洘鐗犲畷妤€鈽夊顓у仺闂侀潧鐗嗗ú锕傦綖閺囩喓绠鹃柛鈩兩戠亸浼存煕鐎ｃ劌濮傞柡灞炬礃缁绘盯宕归鐟颁壕婵°倕鎳忛崵灞轿旈敐鍛殲闁稿缍侀弻娑㈠Ψ椤旂粯鍠氶梺鎼炲€栭悷褔骞?bodyType 缂傚倸鍊搁崐鐑芥倿閿斿墽鐭欓柟娆″眰鍔戦崺鈧い鎺戝€荤壕?
	// - roadObject: THREE.Object3D闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟瀵稿仧闂勫嫰鏌￠崘銊モ偓鑽ょ矆婵犲洦鐓涢柛鎰剁到娴滃墽绱撴担鍓插剰妞わ富鍨抽崣鍛渻閵堝懐绠伴柛鐕佸亰钘熸慨妯垮煐閻撶喖鏌ｅΟ璺ㄧ翱妞ゆ帞鍠栭弻娑㈠Ω閵夈儲姣愰梺宕囩帛閹瑰洭鐛€ｎ喗鏅滈柦妯侯槷閸戜粙姊洪懡銈呅俊妞煎妿閹峰啴鏁冮崒姘優闂佺粯顭囩划顖炲磻閿濆鐓熼柟瀛樼箖瀹告繄鐥幆褎鍋ラ柡灞稿墲閹峰懘妫冨☉鎺戜壕闁哄稁鍋嗛惌澶屸偓骞垮劚濡瑩宕曢悢鍏肩厪闊洦娲栧暩濠碘€冲级閹倿寮婚埄鍐ㄧ窞閻忕偞鍨濋幋鐑芥⒑閸濆嫭濯奸柛瀣工椤曪綁顢曢敃鈧粻濠氭偣閸ヮ亜鐨烘い鎾存そ濮婇缚銇愰幒鎴滃枈闂佸摜濮甸〃濠囧箖?tile 闂傚倷娴囬褍霉閻戣棄鏋侀柟闂撮檷閳ь兛鐒︾换婵嬪炊閵娿儳妯?
	// - groundNode: 闂傚倸鍊风粈渚€骞夐敓鐘冲仭妞ゆ牜鍋涢崹鍌炴煕椤愶絾绀€闁绘帒鐏氶妵鍕箳閸℃ぞ澹曟俊鐐€х粻鎴濈暦椤掑嫬鐓濋柟鎹愵嚙缁狅綁鏌ㄩ弴妤€浜鹃梺鍦嚀閻栧ジ寮婚埄鍐ㄧ窞閹肩补鈧啿啸闂備胶纭堕弲娑㈡儗閸岀偛钃熼柕鍫濐槸娴肩娀鏌涢弴銊ヤ簮闁稿鎸荤换婵嗩潩椤掑偊绱遍梻浣瑰缁诲倿藝娴兼潙鐤炬い鎺戝€甸崑鎾诲礂婢跺﹣澹曢梻渚€鈧偛鑻晶瀵糕偓娈垮櫘閸嬪﹥淇婇崼鏇炲耿婵炲棙蓱闁裤倝姊洪崷顓炲付闁宦板妿閹广垽宕熼娑樺壒闂侀潧鐗嗛ˇ浼存偂閺囥垺鐓ラ柡鍐ㄦ搐琚氱紓浣藉煐閻擄繝寮婚妶澶嬧拹闁归偊鍓欑粊顕€姊洪崫鍕闁活厼鍊搁悾鐑藉醇閺囩倣鈺冩喐瀹ュ＆澶嬫償椤厾绠氶梺闈涚墕閹冲酣鍩€椤掆偓缂嶅﹪寮€ｎ喗鐓?
	// - world: CANNON.World 闂傚倸鍊烽懗鍓佸垝椤栫偛桅婵炴垯鍨归悿鐐節闂堟侗鍎忕紒鐘崇墪閳规垿鎮╅幓鎺撴闂佸磭绮Λ鍐蓟閳ユ剚鍚嬮幖绮光偓鑼嚬婵犵數鍋涢幊蹇撁洪悢鐓庣畺婵°倕鎳庨幑鑸点亜閹捐泛浠掔紒顔ㄥ懐纾藉ù锝囨櫕閸亪鏌涙惔锝嗘毈鐎殿噮鍋勯鍏煎緞婵犲洤鏁归梻渚€娼х换鍡涘礈濠靛棌鏋旈柕蹇ョ磿缁犻箖鎮楀☉娆樼劷闁活厼锕よ灃闁绘娅曢崐鎰偓瑙勬礀缂嶅﹤鐣烽敓鐘冲€婚柛鈩冾殕閻ｅジ姊绘担鍛婂暈缂佽鍊婚埀顒佸嚬閸撶喖骞冨鈧幃鈺冩啑娴ｅ摜绉洪柡浣瑰姍瀹曞崬螣濞差亞鈧儤绻濈喊澶岀？闁稿鐩畷鎰亹閹烘垹顔嗛梺鍛婁緱閸ㄥ崬鐣锋径鎰厪濠电姴绻樺顔界箾閸稑鐏叉慨?
	// - createBody: 闂備浇顕у锕傦綖婢舵劕绠栭柛顐ｆ礀绾惧潡鏌涘Δ鍐ㄥ壉闁哥喎鎳橀弻娑㈩敃閿濆棛顦ョ紓浣插亾闁告洦鍨遍悡鐘绘煙椤撶喎绗掗柛鏃€绮嶇换娑㈠醇濠靛牆鐓熼梺鍝勮閸斿矂鍩ユ径濞㈢喖鎳栭埡鈧槐姗€姊绘担鑺ャ€冮梻鍕Ч瀹曟劙寮介銈囩効閻庡箍鍎卞Λ娆撳磿閻斿吋鐓ユ繛鎴灻鈺呮煛娴ｉ潧鈧牜鎹㈠☉姘ｅ亾濞戞瑯鐒介柣顓烇攻閹便劌顫滈崼銉︻€嶆繛锝呮搐閿曨亪銆佸鈧慨鈧柍銉︽灱閸嬫捇鏌ㄧ€ｅ灚顔旈梺缁樺姌鐏忔瑥顫濋妸鈺傜厱閻庯綆鍋呯亸浼存煙瀹勭増鍤囬柟鐓庣秺瀹曠兘顢橀悩鎻掔瑨濠电姷鏁搁崑娑㈩敋椤撶喐鍙忛柟顖嗏偓閺嬫牗绻涢幋娆忕仼缂佺媭鍨堕弻鐔风暋閹峰矈娼舵繛瀛樼矊缂嶅﹪寮婚弴锛勭杸閻庯綆浜炴禒鑲╃磼濡や礁鐏撮柡宀嬬稻閹棃濡舵惔銏㈢Х闂備焦妞块崣搴ㄥ窗濮樺崬鍨濆┑鐘崇閸嬪嫰鏌ｉ幘铏崳妞わ富鍋勯埞鎴︽倷閺夋垹浠稿銈庡幖濞层劌危閹扮増鏅濋柛灞剧〒閸樿棄鈹戦敍鍕户缂侇噮鍨伴埢宥夊炊椤掍胶鍘?body
	// - maxSegments: 闂傚倸鍊风粈渚€骞夐敓鐘冲仭妞ゆ牜鍋涢崹鍌炴煕椤愶絾绀€闁绘帒鐏氶妵鍕箳閸℃ぞ澹曟俊鐐€х粻鎴濈暦椤掑嫬鐓濋柟鎹愵嚙缁狅綁鏌ㄩ弴妤€浜鹃柣搴㈣壘椤︾敻寮诲鍫闂佸憡鎸婚懝楣冾敋閵夆晛绀嬫い鏇炴噺浜涢梻鍌欑劍閹爼宕濈仦缁㈡闁归棿绀侀悡婵嬫煙閹规劦鍤欓柛銊ュ€归妵鍕箛閸撲胶蓱濡炪倖鏌ㄧ粔鐟邦潖婵犳艾纾兼慨姗嗗墻娴犻箖姊洪崨濠冣拹婵炶尙鍠庨悾鐑藉传閸曞孩妫冨畷銊╊敊閼恒儳褰ㄩ梺璇查閸樻粓宕戦幘缁樼厓鐟滄粓宕滈悢濂夊殨妞ゆ劧绠戝洿闂佺硶鍓濋悷顖毭洪幖浣圭厵闁稿繗鍋愰弳姗€鏌涢妸顭戞綈缂佸倹甯掗～婊堝焵椤掑嫬钃熸繛鎴欏灩缁犳娊鏌熺€涙绠ラ柡鍡愬灲濮婄儤娼幍顔煎闂佸湱鎳撳ú顓㈡偘椤旈敮鍋撻敐搴℃灈缂佺姵绋掗妵鍕箳閹搭厽效闂佸疇顕ч妶鎼佸蓟閿濆牏鐤€闁规儳澧庨澶愭⒑閹肩偛濡藉┑鐐诧躬瀵?collider
export function isRoadDynamicMesh(value: SceneNode['dynamicMesh'] | null | undefined): value is RoadDynamicMesh {
	return Boolean(value && (value as any).type === 'Road')
}
// isRoadDynamicMesh: 缂傚倸鍊搁崐鐑芥嚄閼稿灚鍙忔い鎾卞灩绾惧鏌熼崜褏甯涢柣鎾存礃娣囧﹪濡堕崟顓炲缂備讲鍋撻柛顐ゅ枔缁犻箖鏌涢銈呮瀻闁诲繆鏅犻弻锝咁潩椤掆偓閳锋棃鏌熸搴♀枅闁瑰磭濞€椤㈡牠鎸婃径澶婎棜濠碉紕鍋涢鍛姳閸洖纾婚柟鍓х帛閸嬶繝鏌熷▓鍨灈妞わ絾妞介幃妤冩喆閸曨剛顦ラ梺闈涚墛閹倸顕ｉ銏╁悑闁告侗鍨卞▓鏇㈡⒑闁偛鑻晶瀵糕偓娈垮櫘閸嬪﹥淇婇崼鏇炲耿婵炲棙蓱闁裤倝姊虹涵鍛汗閻炴稏鍎甸崺鈧い鎺嗗亾缁剧虎鍘界€靛ジ宕奸妷锔规嫼闂佸憡绻傜€氼剚绂嶉悙鐑樼厱婵☆垰鎼埛鏃堟煕閹烘挸娴鐐茬Ч椤㈡瑩鎮锋０浣割棜闂佽崵鍠愰悷銉р偓姘煎弮閹啴骞嬮悙鐢殿啎?dynamicMesh 闂傚倸鍊风粈渚€骞栭銈傚亾濮樺崬鍘寸€规洝顫夌€靛ジ寮堕幋鐘垫毎濠电偠鎻徊钘夛耿闁秴鐓?Road 缂傚倸鍊搁崐椋庢閿熺姴纾诲鑸靛姦閺佸鎲搁弮鍫濈畺?
// 闂傚倷绀侀幖顐λ囬锕€鐤炬繝濠傜墕閽冪喖鏌曟繛鍨壄?true 闂傚倷娴囧畷鐢稿磻閻愮數鐭欓煫鍥ㄧ☉缁€澶愬箹濞ｎ剙濡煎鍛攽椤旂瓔鐒惧鏉戞憸閳ь剚纰嶅畝鎼佸蓟閺囩喎绶為柛顐ｇ箓椤牓鏌ф导娆戠瘈婵﹨娅ｇ槐鎺懳熼崫鍕垫綋婵犵數濮崑鎾绘煕濡ゅ啫浜归柡?dynamicMesh 闂傚倸鍊风粈渚€骞夐敓鐘冲仭妞ゆ牜鍋涢崹鍌涖亜閺嶃劎銆掓い鈺傜叀閺岀喖鎮滃Ο璇查瀺婵犳鍨伴悺銊ф崲濠靛洨绠鹃柟顖嗗倸顥氶梻浣藉吹婵敻宕濆Δ鍛獥闁哄稁鍘奸拑鐔兼煕閳╁啰鈽夌紒鐘差煼閺屾盯鏁傜拠鎻掔闂佸摜鍋為幐鎶藉蓟閿濆棙鍎熼柕鍫濆缂嶅牓姊哄ú璇插季闁哥姵姘ㄩ崚鎺撶節濮橆厼浜滈梺鍛婄☉閿曪絽顫濋敃鈧埞鎴︽倷閺夋垹浠哥紓渚囧枤婵炩偓鐎殿喓鍔嶇粋鎺斺偓锝庡亞閸樺崬鈹戦鏂や緵闁告挻宀搁獮鎴︽晲婢跺鍘介梺闈涚箞閸ㄨ崵鏁☉姘ｅ亾閸偅绶查悗姘緲閻ｇ兘鎮㈢喊杈ㄦ櫍闂佺粯鏌ㄩ惃婵嬪磻?

export function collectRoadHeightfieldTileDescriptors(params: RoadHeightfieldBuildParams): RoadHeightfieldBuildSnapshot | null {
	const {
		roadNode,
		rigidbodyComponent,
		groundNode,
		maxSegments,
	} = params

    // collectRoadHeightfieldTileDescriptors: 闂傚倸鍊风粈渚€骞栭銈囩煋闁绘垶鏋荤紞鏍ь熆鐠虹尨鍔熼柡鍡愬€曢妴鎺戭潩閿濆懍澹曢梻浣告惈閼活垰螞濠靛宓佹慨妞诲亾鐎规洜鍏橀、姗€鎮╅崣澶嬫闂傚倷娴囬褍顫濋敃鍌︾稏濠㈣埖鍔栭崕妤併亜閺傚灝鈷斿☉鎾崇Ч閺岋綁寮幐搴㈠枑闂佸磭绮Λ鍐嵁閺嶎偄鍨濋柛蹇擃槸娴滈箖鎮楅崷顓烆€岄柛鐐茬秺濮婂宕掑▎鎴ｇ獥闂佺顑呯€氭媽妫熷銈嗙墬閻旑剟鎳撶捄銊ф／闁诡垎灞藉壄婵炲瓨绮忛～澶愬Φ閸曨垼鏁冩い鎰╁灩缁犲磭绱撴担绛嬪殭婵☆偅绻堝濠氭偄绾拌鲸鏅ｉ悷婊冪Ч閹﹢鎳犻鍌滐紲?
    // 闂傚倷娴囧畷鍨叏瀹曞洦顐介柕鍫濇处椤洟鏌￠崶銉ョ仾闁稿鏅涢埞鎴︽偐閾忣偆娈ら悗瑙勬尫缁舵岸寮婚妶鍥╃煓閻犳亽鍔嬬划鐢告⒑閸濆嫭锛嶅ù婊庝簻椤繑绻濆顒€鑰垮┑掳鍊撶欢鈥澄涢妶澶嬧拺閺夌偘鍗冲鐑芥煕婵犲啰澧辩紒顔碱儏椤撳ジ宕卞Ο鍝勫Τ闂備線娼х换鍡涘箠閸ヮ剙纾婚柟鐐た閺佸秵鎱ㄥΟ鐓庡付婵炲牊锚閳规垿鎮欓崣澶嗘灆婵炲瓨绮庨崑鐘诲Φ閹伴偊鏁嶉柣鎰皺椤旀劙鏌℃径濠勫濠⒀傜矙閹偓娼忛妸褏鐦堥悷婊冾樀瀹曟垿骞樼紒妯锋嫼闂佸憡绋戦敃銈囩箔濮樿埖鐓熸い鎾楀啯鐏撶紓浣戒含閸嬬喖鍩€椤掑﹦绉甸柛鐘愁殜瀹?tile 闂傚倸鍊烽懗鍫曘€佹繝鍥舵晪鐟滃繘骞戦姀鐘栨棃宕ㄩ銏犳暪婵＄偑鍊曠换鎰涘☉姘变笉闁哄啫鐗婇悡銉╂煛閸ヮ煈娈斿ù婊堢畺濮婃椽宕滈懠顒€甯ユ繛瀛樼矌閸嬨倝鐛崘鈺侇嚤闁哄鍤﹂埡鍛叆婵犻潧妫楅埀顒€鎲＄粋?
    // 闂傚倷绀侀幖顐λ囬锕€鐤炬繝濠傜墕閽冪喖鏌曟繛鍨壄婵炲樊浜滈崘鈧銈嗘尵閸嬬喖鏁嶅▎鎾粹拻闁稿本鑹鹃埀顒€顭疯棢闁归偊鍠氶惌?RoadHeightfieldBuildSnapshot 闂?null闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟杈鹃檮閸嬪鏌涢埄鍐噮缂佲偓婵犲洦鍊甸柨婵嗛閺嬫稓绱掗銏⑿ч柡宀嬬到铻ｉ柧蹇曟缁辩偤姊洪棃娑欘棞闁挎洦浜濠氭晬閸曘劌浜鹃柨婵嗙凹缁ㄧ粯銇勮箛濠冩珖缂佽鲸鎹囧畷鎺戔槈濞嗗繒锛撻柣搴㈩問閸ｎ噣宕板璺虹閻庯綆鍠栭幑鑸点亜閹捐泛顎屾俊鍙夋尦濮?

	if (!isRoadDynamicMesh(roadNode.dynamicMesh)) {
		return null
	}
	const definition = roadNode.dynamicMesh
	if ((rigidbodyComponent.props as RigidbodyComponentProps | undefined)?.bodyType !== 'STATIC') {
		return null
	}

    // 闂傚倸鍊风粈渚€骞夐敓鐘冲仭妞ゆ牗绋撻々鍙夌節婵犲倻澧遍柡浣割儐閵囧嫰寮村Δ鈧禍鎯р攽閳藉棗浜滈柛鐕佸亰閸┿垺鎯旈妸銉х杸闂侀潧顭堥崕鐗堢珶閺囩喓绠鹃弶鍫濆⒔閹吋銇勯鐐靛ⅵ闁诡喗锕㈤幃鈺冩啑娴ｅ摜绉洪柡浣瑰姍瀹曞崬螣鐠囨彃澹嶇紓鍌氬€峰ù鍥ㄣ仈閹间礁鐓樼€广儳顦砊IC闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟娆¤娲弻鍡楊吋閸涱喚鈧剟姊虹憴鍕妞ゆ泦鍛笉闁挎繂顦伴悡娆撴煟濡も偓閻楀棝藟鐎ｎ剚鍠愰梺顓ㄧ畱閻忥附顨ラ悙瀵稿婵炵厧绻樺畷婊嗩槾闁哄棛濮撮埞鎴︽偐濞嗗苯浜鹃梺绋款儐閹稿墽妲愰幒妤佸€锋い鎺嗗亾妞ゃ儱顑呴…鑳槼妞ゃ劌锕悰顕€骞囬弶璺唺闂佸湱鍋撳娆擃敁閹剧粯鈷戦柣鐔稿娴犮垽鎮楀鐓庢珝闁绘侗鍣ｆ慨鈧柕鍫濇閸橀亶姊洪崫鍕偓浠嬵敋瑜庢穱濠冪鐎ｎ偆鍘撻悷婊勭矒瀹曟鈽夐姀鈥斥偓鍧楁煥閺囩偛鈧悂宕归崒鐐寸厪濠电姴绻樺顔济瑰┃鍨偓婵嬪蓟閻斿吋鐒介柨鏇楀亾濠⒀屽枤閹噣鎮㈤崗鑲╁幗闁瑰吋鐣崹褰掑窗閺囩姷纾奸柣妯哄暱閻忓鈧娲栫紞濠囧箖瑜斿畷濂告偄婵傚鍋撻幘缁樷拺閻熸瑥瀚粈鍐倶韫囨梻鎳囬柟顔煎槻閳规垿宕遍埡鍐ㄦ暩闂佽崵濮撮幖顐﹀箹椤愶富鏁傛い鎰堕檮閻?

	const roadState = roadNode.components?.[ROAD_COMPONENT_TYPE] as
		| SceneNodeComponentState<RoadComponentProps>
		| undefined
	const roadProps = clampRoadProps(roadState?.props as Partial<RoadComponentProps> | null | undefined)
	const roadWidth = Math.max(0.01, Number.isFinite(roadProps.width) ? roadProps.width : 2)
	const collisionWidth = roadWidth
	const samplingDensityFactor = roadProps.samplingDensityFactor ?? 1.0
	const smoothingStrengthFactor = roadProps.smoothingStrengthFactor ?? 1.0
	const minClearance = roadProps.minClearance ?? 0.01
	const junctionSmoothing = roadProps.junctionSmoothing ?? 0
	const snapToTerrain = roadProps.snapToTerrain
	const heightSampler = groundNode ? resolveRoadLocalHeightSampler(roadNode, groundNode) : null

    // 濠电姷顣藉Σ鍛村磻閸涱収鐔嗘俊顖氱毞閸嬫挸顫濋悡搴♀拫闁芥ɑ绻堥弻宥夊传閸曨剙娅ら梺绋款儑婵炩偓闁哄本鐩崺鍕礃椤忎焦锛夊┑鐘灱椤煤閻旂厧绠栭悷娆忓閻熻銇勯弽銊︾殤濞寸姭鏅犲鍝劽虹拠韫凹闂佹寧娲忛崹浠嬫偘椤曗偓閸┾偓妞ゆ帒鍊归崰鎰節闂堟稓澧涙い顐ｆ礋閺岀喎鈻撻崹顔界亐闂佺顑嗛幐鎯р槈閻㈢宸濇い鏇炴噺椤ュ姊虹拠鍙夊攭妞ゎ偄顦扮换娑欑節閸愌呯畾闁诲孩绋掗…鍥偡瑜版帗鐓冪憸婊堝礈閻旈鏆﹂柧蹇ｅ亜椤曢亶鏌℃径瀣仴闁哥偑鍔戦幃妤呮偡閺夋浠炬繝銏㈡嚀濡宓勯梺鍝勬储閸ㄥ湱绮昏ぐ鎺戠骇闁割偆鍠庣粈鍐磼閳ь剛鈧綆鍠楅悡鍐喐濠婂牆绀傛繛鎴炴皑閻棗銆掑锝呬壕闂佸搫鐭夌粻鎾诲春閳╁啰鐟归柛銉㈡櫅瀵娊姊绘担鐑樺殌闁宦板妿閹广垽宕掑鍕簥婵炴挻鍩冮崑鎾搭殽閻愬澧繛鐓庣箻楠炴垿骞囬鍛ч梻鍌欑窔閳ь剛鍋涢懟顖炲储閹间焦鐓熼柟铏瑰仧閻ｉ亶鏌曢崱妯烘诞鐎规洘绮嶉幏鍛槹鎼粹€斥挄闂傚倸顭崑鍕洪敃鍌氱缂佸绨遍弸宥団偓骞垮劚濞层劎澹曟總鍛婂€堕柣鎰絻缂嶆牠鏌ら崜韫偗闁哄苯绉烽¨渚€鏌涜箛鏃傗槈妞ゎ亜鍟撮獮鎺楀箣椤撶喎鍏婇梻浣瑰濞叉牠宕愰幖浣瑰剹婵°倐鍋撴い顓℃硶閹瑰嫰鎮弶鎴滅矗缂傚倸鍊哥粔鐢稿箰婵犳哎鈧啴濡烽埡鍌氣偓鐑芥煠閸濄儲鏆╃憸鎶婂懐纾藉〒姘搐濞呮瑥鈹戦垾铏窛闁?
    // heightSampler: 闂備浇宕甸崰鎰垝鎼淬垺娅犳俊銈呮噹缁犱即鏌￠崟顐ょ疄濞存粎鎳撻湁闁挎繂鎳忕拹锟犳煟?groundNode 闂傚倸鍊风粈渚€骞栭锕€鐤柟鍓佺摂閺佸﹪鏌熼柇锕€鏋熸い顐ｆ礃缁绘繈妫冨☉鍗炲壉闂佺顑冮崝鎴﹀蓟閺囩喓绡€闊洦绋掗宥夋⒒閸屾艾顏╃紒澶嬫尦濠€渚€姊虹紒妯曟垿鎮￠敓鐙€鏁佹俊銈勮兌缁♀偓闂侀€炲苯澧板瑙勬礈閳ь剨绲婚崝瀣уΔ鍛拺闂傚牊绋撶粻鐐烘煕婵犲啯绀€闁宠绉撮～婵嬫嚋閻㈤潧骞愰柣搴＄畭閸庡崬煤閵堝鍌ㄩ柟缁㈠枟閻撶喐绻濋崹顐㈠闁哄鍠栭弻鐔碱敍濞戞瑯妫冮梺杞扮閸婂潡骞冨▎鎿冩晢闁稿本绋掗蹇涙⒒閸屾瑧顦﹂柟璇х節瀹曞綊宕楅崗鐓庡伎闂侀潧鐗嗛ˇ顖毿?

	const graph = buildRoadGraph(definition)
	if (!graph) {
		return null
	}

    // 闂傚倷娴囬褏鎹㈤幇顔藉床闁归偊鍎靛☉妯锋斀闁搞儮鏅╁ú鎼佹⒑閸涘﹥瀵欓柛鏇ㄥ亞閿涘繑淇婇悙顏勨偓鏍偋濡ゅ啫鍨濈€广儱顦伴崑鈺呮⒑椤掆偓缁夌敻鎮￠弴銏＄厸闁稿本绻嶉崵娆忊攽閳ヨ尙鐭欓柡灞界Х椤т線鏌涜箛鏃傛创闁硅櫕顨婂畷婊勬媴閾忚妲稿┑鐘灱閸╂牠宕濋弴銏犵闁逞屽墴濮婃椽鎮℃惔銏ｇ婵犫拃鍕垫畼缂侇喖锕、娆戜焊閺嶎煈娼旈梻浣筋潐瀹曟ê鈻嶉弴銏犵畾闁割偆鍠撶粻楣冩倵濞戞瑱渚涢柣鎺旀櫕缁辨帗娼忛妸銉﹁癁濡ょ姷鍋為…鍥焵椤掑倹鏆╃痪顓炵埣瀹曟垿骞樺ú缁樻櫖闂佺粯鍔曢悺銊モ枍閺嶎厽鈷戦柛鎾村絻娴滄牠鏌涙惔顔肩仸闁糕斁鍋撳銈嗗坊閸嬫捇鏌ㄩ弴銊ら偗妤?+ 闂傚倷娴囧畷鍨叏瀹曞洦濯伴柨鏇炲€搁崹鍌炴煙濞堝灝鏋熸い鎰矙閺岋綁骞囬鐓庡闂佸搫鎷嬮崜娆撯€﹂崸妤佸殝闁汇垻鍋ｉ埀顒佸笧缁辨帡鍩€椤掍礁绶炲┑鐐村笒缂嶅﹪骞冮埡鍜佹晩闁绘挸楠搁～鎺旂磽閸屾瑧顦﹂柤娲诲灦閹儲绺介崫銉ョウ闂佸綊鍋婇崢鑲╂閻愮儤鍊甸柨婵嗛娴滀即鏌℃担鍦煂缂佽鲸鎸婚幏鍛存偡閺夊灝袘闂備浇顕х换鎴犳崲閸繄鏆﹂悷娆忓閸庣喖鏌嶉柨顖氫壕闂佸搫顑嗛弻銊╂箒闂佹寧绻傞幊搴ㄥ汲閻旇櫣纾奸柣妯烘▕閻撳ジ鏌熼鎸庣【闁宠棄顦灒闁兼祴鏅涙慨閬嶆⒒娓氣偓濞艰崵寰婃總绋跨闁告劕妯婇崵?

	// If per-segment heights are present, build a segment-based sampler and
	// let subsequent curve sampling use it. Otherwise fall back to runtime sampler.
	let serializedSampler: ((x: number, z: number) => number) | null = null
	if (Array.isArray((definition as any).segmentHeights) && Array.isArray(definition.segments)) {
		const rawSegments = Array.isArray(definition.segments) ? definition.segments : []
		const sanitizedSegments: Array<{ a: number; b: number; segmentIndex: number }> = []
		for (let i = 0; i < rawSegments.length; i += 1) {
			const seg = rawSegments[i]
			const a = Number((seg as any)?.a)
			const b = Number((seg as any)?.b)
			if (!Number.isInteger(a) || !Number.isInteger(b)) continue
			if (a < 0 || b < 0 || a >= graph.vertices.length || b >= graph.vertices.length) continue
			sanitizedSegments.push({ a, b, segmentIndex: i })
		}
		const tmpBuild: any = { vertexVectors: graph.vertices, paths: [], sanitizedSegments }
		serializedSampler = createSegmentHeightSampler(tmpBuild, (definition as any).segmentHeights)
	}

    // 濠电姷鏁告慨鐑姐€傛禒瀣劦妞ゆ巻鍋撻柛鐔锋健閸┾偓妞ゆ巻鍋撶紓宥咃躬楠炲啫螣鐠囪尙绐為梺褰掑亰閸撴盯顢欏畝鍕拺鐟滅増甯掓禍鏉棵瑰鍛沪婵炵厧顭峰顒€螞閻㈠灚鍤€妞ゎ厹鍔戝畷姗€鍩℃繝鍐跨磼闂備浇顕ф鎼佹倶濮樺崬鍨濈€光偓閸曨偆鍘洪梺鐟板⒔缁垶宕戦妸鈺傜厱妞ゎ厽鍨垫禍鐐烘煛閸℃瑥校濞ｅ洤锕俊鍫曞川椤撴稑浜剧憸鐗堝笚閺咁亪姊虹拠鍙夊攭妞ゎ偄顦扮换娑欑節閸パ勭€悗骞垮劚椤︻垶鏌ㄩ妶澶嬬厽鐟滃繘鎮ч埡銆唍tHeights闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟娆″眰鍔戦崺鈧い鎺戝€荤壕濂稿级閸稑濡跨紒鐘靛仧閳ь剝顫夊ú姗€鎳濇ィ鍐ㄧ厺閹兼番鍔岀粻娑欍亜閺冨倹鍤€濞存粎鍋撻妵鍕冀閵娿儱姣堥梺鎼炲€曢悧鎾愁嚕閸洘鍊烽柡澶嬪焾濡棗顪冮妶鍛鐎规洦鍓熼崺銉﹀緞閹邦剛顔撻梺鍛婂壃閸涱垱鏅ㄩ梻鍌欒兌缁垶寮婚敓鐘茬；闁规儳顕粻楣冩倵濞戞瑯鐒介柣顓烇躬閹鈽夐幒鎾寸彋濡炪們鍨洪悷銉╂偩濠靛绀嬫い鎺嗗亾闁告搩鍙冨娲川婵犲啫顦╅梺鎼炲妽濠㈡﹢鍩㈠鍜佹僵闁煎摜鏁搁崢鎼佹倵楠炲灝鍔氶柟鍐查鍗辩紓浣诡焽缁犻箖鏌涘☉鍗炴灈婵炴惌鍠栭埞?
    // 闂傚倷娴囧畷鍨叏閺夋嚚娲閵堝懐锛熼梺姹囧灮椤牓姊婚姣綊宕楅崗鑲╃▏闂佸憡鍔忛崑鎾绘煟鎼达絾鍤€閻庢凹鍠楅弲璺何旈崨顔间户闂侀潧鐗嗛幃鑳亹閹烘垹顦ч梺鑹邦潐濠㈡﹢藟濠靛鈷戠紓浣股戦悡娑㈡煕鐎ｎ偅灏扮紒缁樼〒閳ь剚绋掗…鍥儗婵犲伣鏃堟偐閾忣偄鈧劗鈧娲橀悷鈺呭春閸曨垰绀冮柍杞扮婵℃娊姊绘繝搴′簻婵炶绠撻獮鎰板箹娴ｇ懓鈧埖绻涢崱妯诲鞍闁绘挻娲熼弻鈥愁吋閸愩劌顬嬫繝鈷€鍡涘摵缂佺粯鐩畷濂告偄妞嬪簼娣梻浣哥－缁垶骞戦崶顒€绠栧ù鐘差儏娴肩娀鏌曟径鍫濆姤闁瑰鍋婂铏规兜閸涱収妫堥梺瑙勬た娴滎亜顫忔禒瀣妞ゆ牗纰嶆潏鍫ユ⒑缂佹ɑ鈷掗柛妯犲懐涓嶉柛娆忣槶娴滄粓鏌￠崘銊モ偓鍛婄閸撗呯＜缂備降鍨归悘锕傛煛瀹€鈧崰鏍嵁娓氣偓楠炴帡骞嬪┑鍠版挾绱撻崒娆掑厡缂侇噮鍨跺畷褰掑垂椤旂偓娈鹃梺鍓插亝濞叉﹢宕愰悜钘夌骇闁绘劕鐡ㄧ欢鍙夈亜閵夛箑鍝洪柡宀嬬秮閹晜娼忛顐㈠Τ闂備焦鎮堕崝搴ㄥ极缂佹ü绻嗛柟缁㈠枛缁€鍐┿亜閺冨倻鎽傛俊顐㈠暣濮婃椽妫冨☉姘辩杽闂佺锕ラ〃澶愬Φ閹伴偊鏁嶉柣鎰皺椤旀劙鏌℃径濠勫鐎规洘锕㈤、姗€鎼归崷顓狅紲?
    // 濠电姷鏁搁崑娑㈩敋椤撶喐鍙忛柡澶嬪焾濞尖晠鏌ㄩ弴鐐测偓鎼佹倿閸偁浜滈柟鍝勬娴滈箖姊哄ú璇插箹闁稿﹤婀遍埀顒勬涧閵堟悂宕洪敓鐘插窛妞ゆ挾濯Σ顖炴煟鎼达紕鐣柛搴ㄤ憾閹嗙疀閺囩姳绗夐梺闈涱槴閺呮粓宕戦悩宕囩闁瑰鍊栭幋婵撹€块柣妤€鐗呯换鍡涙煟閹邦厼绲婚柍褜鍓欓悘婵嬫偩瀹勬嫈鐔哥瑹椤栨碍鍊梻浣告啞娓氭宕㈡ィ鍐炬晩鐎光偓閸曨兘鎷绘繛杈剧悼閹虫挾寰婄紒妯肩閻犲泧鍛殼闂佽鍟崶銊у姸閻庡箍鍎遍幊蹇撶暤瀹ュ鈷戦柛婵嗗濡插ジ鏌涙惔鈽嗙吋鐎规洖鎼悾婵嬪礋椤掑倸骞嶉梺璇插缁嬫帡鈥﹂崶銊︽珷妞ゅ繐鐗婇悡鏇熺箾閸℃ê鐏ュù婊冨⒔缁辨帡宕掑☉妯昏癁閻庢鍠栭埀顒傚櫏濡插鎮跺鍗炴灈婵﹨娅ｉ幏鐘诲灳閸愭彃绠伴梻浣虹帛鐢亞绮婚幋锔光偓锕傚炊椤掍緡妫冨┑鐐村灦鐢寮悩缁樷拺閻熸瑥瀚ˉ鎰版煛閸屾瑧绐旂€?
	const roadSurfaceHeightSampler = serializedSampler
		? serializedSampler
		: snapToTerrain
			? heightSampler
			: (_x: number, _z: number) => 0
	if (!roadSurfaceHeightSampler) {
		return null
	}

    // roadSurfaceHeightSampler 闂傚倸鍊风粈渚€骞栭锔藉亱闁告劦鍠栫壕濠氭煙閹冾暢缁炬崘妫勯湁闁挎繂鎳忛幉绋款熆瑜庡鑽ゆ閹烘鐭楁俊顖氭惈缁侇噣鎮楀▓鍨灆闁告濞婇妴浣糕槈濮楀棙鍍甸梺绋跨箰閸氬骞冨▎蹇婃斀闁绘劖娼欓悘锕傛煙閸涘﹥鍊愭い銏＄墵瀹曠喖顢橀悩鐢垫殽濠电偞鎸婚崺鍐磻閹剧粯鐓欓柧蹇ｅ亝瀹曞瞼鈧娲忛崝鎴︺€佸Δ鍛＜闁靛牆鎳忛崐娑欑節閻㈤潧浠﹂柛銊ョ埣楠炴劙骞橀鑲╋紱闂佺懓澧界划顖炴偂?
    //  - serializedSampler: 闂備浇顕уù鐑藉箠閹捐绠熼梽鍥Φ閹版澘绀冩い蹇撴搐灏忔俊鐐€栭幐鍫曞垂閸︻厾鐭嗛柛鈩兠肩换鍡涙煏閸繂鈧憡绂嶆ィ鍐╃厽閹艰揪绱曟禒娑㈡煟閹垮嫮绡€妤犵偛妫濆畷姗€顢欓懖鈺婃Ч婵＄偑鍊栧濠氬磻閹剧粯鐓熼柨鏂垮⒔鐢稓绱掔紒妯兼创鐎规洖銈告慨鈧柍鈺佸暞閻︽捇姊绘担铏瑰笡缂佽绉瑰畷鏉课旈崨顓犵暰闂佸搫鍟悧濠囧疾濠靛鐓曢悘鐐插⒔椤ｆ煡鏌ｅ┑鍛祮婵﹥妞藉畷顐﹀礋椤撳鍨介弻娑㈠閳ュ磭绁烽梺瀹狀嚙缁夊綊鐛幒鎳虫梹鎷呯憴鍕建闂傚倷绀佹竟濠囧磻閸涱垰鍨濋幖娣妼缁愭鎱ㄥ璇蹭壕闂佸搫鏈粙鏍不濞戙垹绠婚悹楦裤€€閹奉亞绱?
    //  - heightSampler: 濠电姷鏁搁崑娑㈩敋椤撶喐鍙忛悗娑欙供濞堢晫绱掔€ｎ亜鐨￠柤鎷屾硶閻ヮ亪骞嗚閸庡秴霉濠婂啰绉洪柡灞炬礉缁犳稓鈧綆浜栭崑鎾诲即閻愨晜鐎哄┑顔筋焾閸╂牠鎮″☉姘ｅ亾楠炲灝鍔氭い锕佹铻為柟瀵稿仧缁犻箖鏌涢銈呮瀻闁诲繐顕埀顒冾潐濞叉﹢鎮烽埡鍛疇闁绘劕鎼敮闂佹寧姊婚悺鏃堝疮閳ь剟姊婚崒娆戝妽閻庣瑳鍛煓闁硅揪闄勯崑瀣煕閳╁啰鎳呯紒鈧?snapToTerrain 濠?true闂?
    //  - 闂傚倸鍊峰ù鍥敋閺嶎厼鍌ㄩ柣锝呮湰閺嗘粌鈹戦悩鎻掝仾閻?0 闂傚倸鍊烽悞锕傛儑瑜版帒绀夌€光偓閳ь剟鍩€椤掍胶鐓柛妤€鍟块悾鐑芥惞椤愩埄鍤ら梺鍝勵槹閸ㄧ敻宕妸鈺傚€甸柣鐔告緲椤忣偄顭胯椤ㄥ﹪骞冮悽绋课у璺侯儑閸欏棗鈹戦悙鏉戠仸妞ゎ厼娲﹂弲鍫曟晲婢跺鈧灚鎱ㄥΟ绋垮姎闁诲浚浜炵槐鎺斺偓锝庝憾濡插憡銇勯幘鐐藉仮鐎规洦浜濋幏鍛村川婵犲骸鏅犲┑鐘愁問閸犳鏁悙闈涘灊妞ゆ牜鍋涚粈澶愭煛閸モ晛鍓抽柤鎷屾硶閻ヮ亪骞嗚閸庡秴霉濠婂棭娼愰柕鍥у椤㈡洟顢曢姀鐘殿啋闂備浇宕甸崳銉╁礈閻旂厧钃熼柨鐔哄Т缁€鍐┿亜韫囨挸鐝旈柨婵嗘娴滄粓鏌￠崒娑橆嚋婵犫偓閻楀牄浜滈柕濞垮劜閹兼劙鎽堕敐澶嬬厱婵犻潧妫楅鎾煕閻愬瓨銇濇慨濠勫劋濞碱亪骞忕仦钘夊腐濠电姭鎷冮崟鍨暥闂佷紮绲介悘姘辩箔閻旂厧鐒垫い鎺戝閺?

	const boundaryWallComponent = roadNode.components?.[BOUNDARY_WALL_COMPONENT_TYPE] as
		| SceneNodeComponentState<BoundaryWallComponentProps>
		| undefined
	const boundaryWallEnabled = boundaryWallComponent?.enabled !== false && Boolean(boundaryWallComponent)
	const boundaryWallProps = boundaryWallEnabled
		? clampBoundaryWallComponentProps(boundaryWallComponent?.props as Partial<BoundaryWallComponentProps> | null | undefined)
		: null
	const surfaceNode = boundaryWallEnabled
		? {
			...roadNode,
			components: Object.fromEntries(
				Object.entries(roadNode.components ?? {}).filter(([type]) => type !== BOUNDARY_WALL_COMPONENT_TYPE),
			),
		}
		: roadNode
	const curves = buildRoadCurvesFromGraph(junctionSmoothing, graph)
	if (!curves.length) {
		return null
	}

    // boundaryWallEnabled: 闂傚倸鍊风粈渚€骞夐敍鍕殰闁搞儺鍓欑壕褰掓煛瀹ュ骸骞栭柦鍐枛閺屾盯濡烽鐓庮潻闂佸憡鐟ラ敃銉╁Φ閸曨垰鍐€闁靛ě灞炬闂備胶顭堟鎼佹晝椤忓牆钃熸繛鎴烇供濞尖晠鏌ｉ幘铏崳濞寸媭鍨跺鐑樻姜娴煎瓨顎栭梺绋匡攻閻楁粎鍒掔€ｎ亶鍚嬪璺猴工閼板灝鈹戦绛嬬劸濞存粠鍓濋妵鎰偅閸愨斁鎷烘繛鏉戝悑閻熝囧礆娴煎瓨鐓犳繛鑼额嚙閻忥箓鏌曢崱妤€鈧灝鐣峰鍡╂Ь缂佺偓鍎抽妶鎼佸蓟濞戙垹鍗抽柕濞垮€楅崙鐟邦渻閵堝棗濮冪紒顔界懇瀵濡搁妷銏☆潔濠碘槅鍨伴悘婵嬵敂椤撶儐娓婚柕鍫濆€归弳姗€鏌涢妷鎴濆暙濞堛倖绻濋悽闈浶㈤柨鏇樺€濆畷顖烆敍閻愯尙锛熷┑鐐叉閹稿鎮￠悢鎼炰簻妞ゆ劦鍋勬晶顔尖攽閳ョ偨鍋㈤柡灞剧洴閳ワ箓骞嬪┑鍫滃寲闂備礁缍婇ˉ鎾存叏閻戣棄绠柣妯款嚙缁犵敻鏌熼悜妯烩拹闁稿瑪鍥ㄢ拻濞达絼璀﹂悞鍓х磼缂佹﹩娈旈柍缁樻煥閳藉濮€閳ュ啿澹嶆繝娈垮枟閵囨盯宕戦幘鎼闁绘劏鏅涙禍楣冩煟閻斿摜鐭婄紒澶婄秺楠炲﹪鎮㈤崗鐓庝簻闂佺粯鎸哥€涒晛鐣?surfaceNode 濠?
    // 缂傚倸鍊搁崐椋庣矆娓氣偓钘濇い鏍亹閳ь剨绠戦悾锟犲箥閾忣偆鈧?boundary wall 缂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗ù锝堛€€閸嬫挸顫濋梻瀵哥泿闂佸疇顕ч柊锝嗘叏閳ь剟鏌曢崼婵囶棡婵炲懏鐗犲娲礈閹绘帊绨撮梺鎼炲妽濡炶棄顕ｇ€圭姷鐤€闁瑰彞鑳堕幊鎾烩€﹂妸鈺佺妞ゆ洖鎳夐崑鎾澄旈崨顔惧幍濡炪倖姊婚悺鏂库枔濡偐纾奸弶鍫涘妼濞搭喗銇勯姀鈽呰€块柟顔规櫊閹煎綊顢曢敐搴濇埛闂?collider 闂傚倸鍊风粈渚€骞栭锕€鐤柛鎰ゴ閺嬫牗绻涢幋鐐叉疇濞存粌婀遍幉鎼佸籍閸繄鐤囬梺瑙勫礃椤曆呯矆閸愨斂浜滈柟鎹愭硾濞呭繘鏌嶈閸撴艾鐣濈粙娆炬綎婵炲樊浜堕弫鍡椕归敐鍥ㄥ殌缁鹃敮鏅犲鍝劽虹拠鎻掔婵犫拃鍌滅煓妤犵偛鍟€靛ジ寮堕幊鏂ユ櫊閺屽秹宕崟顐熷亾瑜版帒违闁告劦鍠楅埛鎴︽煕濠靛棗顏褔浜堕弻娑㈠箻鐎靛摜鐤勫┑鈽嗗亜閹虫﹢宕洪敓鐘插窛妞ゆ棁濮ら悵?
    // buildRoadCurvesFromGraph: 闂傚倷娴囬褏鎹㈤幇顔藉床闁归偊鍎靛☉妯滄棃鍩€椤掑嫭绠掓繝纰樻閸ㄧ敻宕戦幇顔碱棜濠靛倸鎲￠悡娆撴煙椤栧棗鑻▓鍫曟⒑闁偛鑻晶濠氭煕閵娿儱鑸规い顓炴喘椤㈡棃宕奸锝嗘珜濠电偠鎻徊鍧椻€﹂崼銏ｅС闁靛濡囩粻楣冩煙鐎电浠︾€规洖瀚穱濠傤渻閻撳骸顬嬬紓渚囧枓閺呮繈鍩€椤掑嫭娑ч柟鑺ョ矌婢规洘绺介崨濠勫幈闂佸搫娲㈤崝灞剧娴煎瓨鐓欓柛鎾村絻婢ь垳绱掔紒妯肩畺缂佺粯绻堝畷姗€濡歌濡楁挻绻濋悽闈涗沪鐟滄澘鍟撮獮妤€顭ㄩ崼鐔峰墻濡炪倕绻愰悧鍡欑矆瀹€鍕叆婵炴垶锚椤忣偅銇勯敂瑙勬珚婵﹤鎼叅缂備焦锚閳诲繘姊洪崨濠冪叆妞ゆ垵娲幊鐐烘焼瀹ュ孩鏅㈤梺鍛婃处閸嬪棝顢欓崶銊х瘈闁靛骏绲剧涵鐐亜閹存繃顥㈤柡灞诲姂婵″爼宕堕埡鍐跨床闂備浇顕栭崹搴ㄥ川椤掑啯顎楅梻鍌欑劍閹爼宕濈仦缁㈡闁归棿绀侀悡婵嬫煙閸撗呭笡闁稿鍔庣槐鎺斺偓锝庡亜椤曟粓鏌ｅ┑鍛祮婵﹥妞藉畷顐﹀礋椤撳鍨介弻娑㈠Χ閸℃瑥鈷堝┑?

	const hasSegmentHeights = Boolean(serializedSampler)

	const desiredTileLength = clampNumber(roadWidth * 8, ROAD_HEIGHTFIELD_MIN_TILE_LENGTH, ROAD_HEIGHTFIELD_MAX_TILE_LENGTH, ROAD_HEIGHTFIELD_DEFAULT_TILE_LENGTH)
	const maxBodies = typeof maxSegments === 'number' && Number.isFinite(maxSegments)
		? Math.max(1, Math.trunc(maxSegments))
		: 128

    // 闂傚倷娴囧畷鍨叏瀹曞洦顐介柕鍫濇处椤洟鏌￠崶銉ョ仾闁稿鏅涢埞鎴︽偐瀹曞浂鏆￠梺绋款儍閸婃繈寮婚妸鈺佺睄闁逞屽墴瀹曟洟骞庢慨鎰ㄥ亾閸屾稓绡€婵﹩鍘鹃崣鍡椻攽閻愭潙鐏﹂拑杈╃磼閸撲礁澹榣e闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟娆¤娲畷锟犳倶閺勫浚娼愮€垫澘瀚伴獮鍥敆閸屻倖袧闂傚倷绀侀幉锟犲礉閺嶎兙浜归柛鎰╁壆濞戞﹩娼ㄩ柍褜鍓熷濠氬焺閸愨晛顎撶紓浣割儓濞夋洟鎯勬惔锝囩＝濞达絿顭堢紞渚€鏌涘Δ鈧崯鍧楊敋閿濆鍋ㄩ柛娑橈工娴滄粓姊洪崨濠勨槈闁挎洩绠撻、娆撳冀椤撶啿鎷洪梺缁樺灍閺呮粓锝炴径濞炬斀闁炽儴娅曟径鍕煛閸涱厾鍩ｇ€殿喕绮欓、姗€鎮㈤崣澶婎伕闂傚倷绀佹竟濠囨偂閸儱绐楅柡宥庡弾閺佸﹤鈹戦悩鍙夊闁绘挸绻橀弻娑㈠焺閸愨晝顦梺鍛婃煥缁夊綊寮婚敐澶嬫櫆闁兼祴鏅濋惁鍫ユ⒑鐠団€虫灍婵＄偘绮欏顐﹀磼閻愯尙鐣鹃悷婊勭矒瀵娊顢楅崟顑芥嫼濠殿喚鎳撳ú銈嗕繆婵傚憡鍊垫慨妯煎帶閺嬨倗绱掓潏鈺佷沪鐎垫澘瀚伴獮鍥敆閳ь剟宕妸鈺傗拺闁绘挸娴风粔娲煕鐎ｎ亷韬€殿喓鍔嶇粋鎺斺偓锝庡亞閸樺憡绻涙潏鍓ф偧妞ゎ厼鐗忛懞閬嶆嚒閵堝洨锛滈柡澶婄墑閸斿酣骞婇崶顒佺厵妞ゆ牗鑹鹃顓熴亜閵忥紕鎳囬柟顔煎⒔娴狅箓鎮剧仦鑲╃闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟娆″眰鍔戦崺鈧い鎺戝€荤壕濂稿级閸稑濡跨紒鐘崇墱缁辨帡宕掑☉妯昏癁婵犵绱曢崗妯讳繆閻戣棄唯闁挎洍鍋撻柣銊ｅ姂濮婄粯鎷呮笟顖滃姼缂備胶绮崝娆忕暦椤栫偛绠ユい鏂垮⒔閻掑ジ鎮楅崗澶婁壕闂侀€炲苯澧紒鍌氱Ч楠炴牗鎷呴梹鎰倞闂備礁鎲″ú鐔奉焽瑜嶉埢?
    // elementSize 闂傚倸鍊烽悞锕€顪冮崹顕呯劷闁秆勵殔缁€澶愭倵閿濆骸澧插┑顔挎珪閵囧嫰骞掗幋婵愪患闂佸憡鍨规繛鈧柡灞剧洴瀵挳濡搁妷銈囨晼缂傚倷鐒﹂崬鑽ょ不閹达絿浜欓梻浣侯焾閺堫剟鎳撴禒瀣垫晜闁糕€崇箰娴滈箖鎮峰▎蹇擃仼闁崇粯娲滈埀顒冾潐濞叉粓宕楀鈧獮鏍亹閹烘垶宓嶅銈嗘尵婵矁顦规慨濠冩そ瀹曨偊宕熼澶堝灲閺屾稑顫濋澶婂壈濡炪値浜滈崯鏉戠暦閹烘鍊烽柛娆忣槸缁佸爼姊绘笟鈧褔鈥﹂崼銉ョ？闂侇剙绂嬮悜钘夊窛閻庢稒顭囬崢鍗炩攽椤旀枻渚涢柛妯恒偢閹﹢鏁冮崒娑氬幐閻庡厜鍋撻柍褜鍓熷畷浼村冀瑜忛弳锕傛煏婢跺棙娅呯紒鐙呯稻缁绘繃绻濋崒娑樻闂佺懓妯婃禍顏勵潖閸濆嫅褔宕惰椤牓鏌ｆ惔銏㈢叝闁告鍟块悾鐑芥惞椤愩埄鍤ら梺鍝勵槹閸ㄧ敻宕妸鈺傗拺缂備焦锚閻忓崬鈹戦鍝勨偓婵嬪极瀹ュ鍋勯柛蹇曞帶娴?

	let totalBodies = 0
	const tiles: RoadHeightfieldTileDescriptor[] = []
	let signatureHash = 0
	let layoutHash = 0
	let representativeDesiredTileLength = desiredTileLength
	let representativeElementSize = Math.max(1e-4, desiredTileLength / ROAD_HEIGHTFIELD_MAX_ROWS)

	let curveIndex = 0
	for (const descriptor of curves) {
		if (totalBodies >= maxBodies) {
			break
		}
		const curve = descriptor.curve
		const subsegments = collectRoadCurveSubsegments(curve)
		let segmentIndex = 0
		for (const segment of subsegments) {
			if (totalBodies >= maxBodies) {
				break
			}
			const length = segment.getLength()
			if (!(length > 1e-6)) {
				segmentIndex += 1
				continue
			}
			const geometryDetail = computeCurveGeometryDetailScore(segment, length)
			const divisions = computeRoadDivisionsForCurve(segment, length, samplingDensityFactor, junctionSmoothing, geometryDetail)
			if (divisions < 2) {
				segmentIndex += 1
				continue
			}
			const smoothedHeights = buildRoadCenterlineHeightSeries({
				curve: segment,
				divisions,
				heightSampler: roadSurfaceHeightSampler,
				minClearance,
				smoothingStrengthFactor,
				smooth: !hasSegmentHeights,
			})
			const heightDetail = computeRoadHeightDetailScore(smoothedHeights, length)
			const heightRange = computeRoadHeightRange(smoothedHeights)
			const samplingDetail = Math.max(0, Math.min(1, geometryDetail * 0.15 + heightDetail * 0.85))
			const densityScale = Math.max(0.35, Math.min(1.5, Math.sqrt(clampNumber(samplingDensityFactor, 0.1, 10, 1.0) / 3.5)))
			const targetRows = Math.max(
				ROAD_HEIGHTFIELD_MIN_ROWS,
				Math.min(ROAD_HEIGHTFIELD_MAX_ROWS, Math.round((ROAD_HEIGHTFIELD_MIN_ROWS + samplingDetail * (ROAD_HEIGHTFIELD_MAX_ROWS - ROAD_HEIGHTFIELD_MIN_ROWS)) * densityScale)),
			)
			const desiredTileLengthForCurve = clampNumber(
				roadWidth * lerpNumber(16, 8, geometryDetail),
				ROAD_HEIGHTFIELD_MIN_TILE_LENGTH,
				ROAD_HEIGHTFIELD_MAX_TILE_LENGTH,
				desiredTileLength,
			)
			const elementSize = Math.max(1e-4, desiredTileLengthForCurve / targetRows)
			if (curveIndex === 0 && segmentIndex === 0) {
				representativeDesiredTileLength = desiredTileLengthForCurve
				representativeElementSize = elementSize
			}
			layoutHash = (layoutHash * 31 + Math.round(geometryDetail * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(heightDetail * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(heightRange * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + targetRows) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(desiredTileLengthForCurve * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(elementSize * 1000)) >>> 0
			smoothedHeights.forEach((value) => {
				const normalized = Math.round((Number.isFinite(value) ? value : 0) * 1000)
				signatureHash = (signatureHash * 31 + normalized) >>> 0
			})

			const spans = collectRoadCollisionSpans(segment, divisions, smoothedHeights)
			const spanP0 = new THREE.Vector3()
			const spanP1 = new THREE.Vector3()
			const spanForward = new THREE.Vector3()
			const spanCenter = new THREE.Vector3()
			let tileIndex = 0
			for (const span of spans) {
				if (totalBodies >= maxBodies) {
					break
				}
				const startU = span.startIndex / divisions
				const endU = span.endIndex / divisions
				segment.getPoint(startU, spanP0)
				segment.getPoint(endU, spanP1)
				spanForward.copy(spanP1).sub(spanP0)
				const forwardLen = Math.hypot(spanForward.x, spanForward.z)
				let yaw = 0
				if (forwardLen > ROAD_EPSILON) {
					yaw = Math.atan2(spanForward.x, spanForward.z)
				} else {
					const midU = (startU + endU) * 0.5
					const tangent = segment.getTangent(midU)
					yaw = Math.atan2(tangent.x, tangent.z)
				}
				spanCenter.copy(spanP0).add(spanP1).multiplyScalar(0.5)
				const spanLength = Math.max((span.endIndex - span.startIndex) * (length / divisions), forwardLen)
				layoutHash = (layoutHash * 31 + curveIndex) >>> 0
				layoutHash = (layoutHash * 31 + segmentIndex) >>> 0
				layoutHash = (layoutHash * 31 + tileIndex) >>> 0
				layoutHash = (layoutHash * 31 + span.startIndex) >>> 0
				layoutHash = (layoutHash * 31 + span.endIndex) >>> 0
				layoutHash = (layoutHash * 31 + (span.kind === 'box' ? 1 : 2)) >>> 0
				if (span.kind === 'box') {
					const spanHeights = smoothedHeights.slice(span.startIndex, span.endIndex + 1)
					const boxOverlapMeters = Math.min(
						span.boxOverlapMeters ?? ROAD_BOX_JOIN_MIN_OVERLAP_METERS,
						Math.max(0, spanLength * 0.45),
					)
					layoutHash = (layoutHash * 31 + Math.round(boxOverlapMeters * 1000)) >>> 0
					const boxLength = spanLength + boxOverlapMeters * 2
					const boxShape = buildRoadRectangularTileShapeFromSeries({
						roadWidth: collisionWidth,
						length: boxLength,
						heights: spanHeights,
					})
					if (!boxShape) {
						continue
					}
					const surfaceHeight = spanHeights.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / spanHeights.length
					const boxHalfY = boxShape.kind === 'box' ? boxShape.halfExtents[1] : 0
					tiles.push({
						curveIndex,
						tileIndex,
						startIndex: span.startIndex,
						endIndex: span.endIndex,
						position: [spanCenter.x, surfaceHeight - boxHalfY, spanCenter.z],
						yaw,
						shapeDefinition: boxShape,
					})
				} else {
					const rows = Math.max(2, Math.ceil(spanLength / elementSize))
					const fieldShape = buildHeightfieldShapeFromSeries({
						startIndex: span.startIndex,
						endIndex: span.endIndex,
						rows,
						elementSize,
						roadWidth: collisionWidth,
						heights: smoothedHeights,
					})
					if (!fieldShape) {
						continue
					}
					tiles.push({
						curveIndex,
						tileIndex,
						startIndex: span.startIndex,
						endIndex: span.endIndex,
						position: [spanCenter.x, 0, spanCenter.z],
						yaw,
						shapeDefinition: fieldShape,
					})
				}
				totalBodies += 1
				tileIndex += 1
			}
			segmentIndex += 1
		}
		curveIndex += 1
	}

	if (!tiles.length) {
		return null
	}

	return {
		surfaceNode,
		tiles,
		heightHash: signatureHash,
		layoutHash,
		roadWidth,
		collisionWidth,
		samplingDensityFactor,
		smoothingStrengthFactor,
		minClearance,
		junctionSmoothing,
		desiredTileLength: representativeDesiredTileLength,
		elementSize: representativeElementSize,
		boundaryWallEnabled,
		boundaryWallProps,
	}
}

// 闂傚倷绀侀幖顐λ囬锕€鐤炬繝濠傜墕閽冪喖鏌曟繛鍨壄婵炲樊浜滈崘鈧銈嗘尵閸嬬喖鏁嶅▎鎾粹拺闁绘挸娴风粔娲煕鐎ｎ亷韬€规洟娼ч埥澶愬閿涘嫬骞愰梻浣告啞濞诧箓宕戦崟顖氬惞閺夊牃鏅濈壕濂稿级閸碍娅嗛柣婵囨敿adHeightfieldBuildSnapshot 闂傚倸鍊风粈渚€骞夐敓鐘冲亱闁哄洢鍨圭粻鐘诲箹濞ｎ剙濡肩紒鐘冲哺閺屾盯顢曢妶鍛亖濡炪倐鏅滈悡锟犲蓟濞戙垹鐒洪柛鎰⒔閸旂兘姊洪柅鐐茶嫰婢у鏌涢妸銈呭祮妞ゃ垺鑹鹃埢搴☆嚗濠靛洦銇濇い銏℃瀹曞崬螖閸曨剙顏╅梻鍌欒兌椤㈠﹥绔熼崼銉ョ妞ゅ繐妫涙稉宥夋煙鐎涙濡囬柡鈧敃鍌涚厓鐟滄粓宕滈悢鐓庤摕闁绘柨鎼弸鍫熶繆椤栨繃銆冨瑙勬礋濮婂宕掑顑藉亾缁嬫５娲偐鐠囪尙锛涢梺鐟板⒔缁垶鎮￠悢鍏肩厪濠电偛鐏濋崝姘亜韫囷絼绨绘い顓″劵椤﹁尙绱掓径灞惧殌妞ゆ洩缍佸畷褰掝敃閵忋垻鐛梺璇茬箳閸嬬喖宕戦幘璇茬獥闁圭儤顨嗛埛鎴犵磽娴ｇ櫢渚涙繛鍫熸⒐缁绘稓鎷犺閻ｈ鲸銇勯弴顏嗙М妤犵偞鍔栭幆鏃堬綖椤撶喎鏀梻鍌欐祰椤顢欓弽顓為棷妞ゆ洍鍋撶€规洘娲樼换婵嬪炊閵娧冨妇?
// 闂傚倸鍊搁崐椋庢閿熺姴绀堟慨妯挎硾缁犳彃銆掑锝呬壕闂佽鍨伴惌鍌炲箖濞嗘搩鏁嗛柛灞绢殕閻忓啴姊虹涵鍛汗閻炴稏鍎靛畷婊冣攽鐎ｎ亞顦伴梺鍛婃寙閸曨偅鐎鹃梻浣哄帶婢瑰﹪宕滃▎鎾村€舵い鏃傛櫕缁犻箖鏌℃径瀣劸婵☆垪鍋撻柣搴ゎ潐濞叉﹢銆冮崨瀛樺仼闁绘垼妫勯悙濠囨煏婵炑冨椤斿繒绱撻崒姘偓鐑芥倿閿斿墽鐭欓柟鐑橆殔绾惧潡鏌熼幆鐗堫棄缂佺姵鐗犻弻锟犲炊閳轰焦鐏侀梺宕囨嚀缁夊綊寮诲澶婄厸濞达絽鎲″▓銊х磽娴ｄ粙鍝洪柣妤佹礋濠€渚€姊虹紒姗堜緵闁哥姵鐗犲畷婵嗩潩閹典礁浜炬繛鍫濈仢閺嬨倝鏌涜箛鏃撹€挎鐐插暞缁傛帞鈧綆鈧厸鏅犻弻鏇㈠醇濠靛洨鈹涙繝銏ｎ潐閿曘垹顫忓ú顏勫窛濠电姴鍊搁～宀€绱撴担鍓叉Ц闁绘牕銈搁幃浼搭敋閳ь剙鐣烽幆閭︽濠电偤妫块崡鎶藉蓟閺囥垹閱囨繝闈涙祩濡倝姊洪柅鐐茶嫰婢у鏌涢妸銈呭祮妞ゃ垺鑹鹃埢搴ㄥ箻鐎涙ê鍔掗梺鑽ゅ枑閻熴儳鈧凹鍣ｅ鎶芥偐缂佹ǚ鎷洪梺鍛婄☉閿曪箓骞婇崘顔界厱濠电姴鍊荤粔铏光偓娈垮枟婵炲﹪骞冮姀銈呯闁稿繐鍚嬮悵顐︽⒒娴ｇ顥忛柛瀣噽閸掓帗鎯旈妸銉у幋闂佸湱鍎ら崵姘舵偡闁妇鍙嗛梺鍛婂姀閺呮粌鐣峰畷鍥╃＝濞达絿鎳撻弫鎯р攽閳ヨ櫕鍠橀柛鈹惧亾濡炪倖甯婇懗鍫曞煀閺囥垺鐓ユ慨妯垮煐閻撴瑩鏌у顒€鈧鐣甸崱娆屽亾濞堝灝鏋欑紒顔界懇瀵偊骞樼紒妯轰汗闂傚倸鐗婄粙鎾绘偂閹达附鈷掑ù锝囨嚀椤曟粎绱掔€ｎ偄鐏撮挊婵囥亜閹惧崬鐏╅柣?

export function buildRoadHeightfieldBodies(params: RoadHeightfieldBuildParams): RoadHeightfieldBodiesEntry | null {
	const snapshot = collectRoadHeightfieldTileDescriptors(params)
	if (!snapshot) {
		return null
	}
	const {
		roadNode,
		rigidbodyComponent,
		roadObject,
		groundNode = null,
		createBody,
	} = params

	roadObject.updateMatrixWorld(true)

	const bodies: CANNON.Body[] = []
	for (const tile of snapshot.tiles) {
		if (!tile.shapeDefinition) {
			continue
		}
		const tileObject = new THREE.Object3D()
		tileObject.rotation.set(0, tile.yaw, 0)
		tileObject.position.set(tile.position[0], tile.position[1], tile.position[2])
		roadObject.add(tileObject)
		tileObject.updateMatrixWorld(true)
		const bodyResult = createBody(snapshot.surfaceNode, rigidbodyComponent, tile.shapeDefinition, tileObject)
		roadObject.remove(tileObject)
		if (bodyResult?.body) {
			;(bodyResult.body as CANNON.Body & { name?: string }).name = `road-tile:${roadNode.id}:curve:${tile.curveIndex}:tile:${tile.tileIndex}`
			bodies.push(bodyResult.body)
		}
	}

	if (snapshot.boundaryWallEnabled) {
		const boundaryBodyResult = createBody(roadNode, rigidbodyComponent, null, roadObject)
		if (boundaryBodyResult?.body) {
			bodies.push(boundaryBodyResult.body)
		}
	}

	if (!bodies.length) {
		return null
	}

	const signature = buildRoadHeightfieldSignature({
		definition: roadNode.dynamicMesh as RoadDynamicMesh,
		roadNode,
		groundNode,
		roadWidth: snapshot.roadWidth,
		collisionWidth: snapshot.collisionWidth,
		samplingDensityFactor: snapshot.samplingDensityFactor,
		smoothingStrengthFactor: snapshot.smoothingStrengthFactor,
		minClearance: snapshot.minClearance,
		junctionSmoothing: snapshot.junctionSmoothing,
		elementSize: snapshot.elementSize,
		desiredTileLength: snapshot.desiredTileLength,
		bodyCount: bodies.length,
		heightHash: snapshot.heightHash,
		layoutHash: snapshot.layoutHash,
		boundaryWallEnabled: snapshot.boundaryWallEnabled,
		boundaryWallProps: snapshot.boundaryWallProps,
	})

	return { signature, bodies }
}


// 路面表面Y轴偏移量（米），用于防止Z-fighting
const ROAD_SURFACE_Y_OFFSET = 0.01
// 路面相关计算的极小误差值
const ROAD_EPSILON = 1e-6
// 路段最小分段数，保证几何精度
const ROAD_MIN_DIVISIONS = 4
// 路段最大分段数，防止过度细分
const ROAD_MAX_DIVISIONS = 256
// 路段分段密度，单位长度内的分段数
const ROAD_DIVISION_DENSITY = 8

// 路面高度平滑的最小迭代次数
const ROAD_HEIGHT_SMOOTHING_MIN_PASSES = 3
// 路面高度平滑的最大迭代次数
const ROAD_HEIGHT_SMOOTHING_MAX_PASSES = 12

// 路面最大坡度（斜率），防止过陡
const ROAD_HEIGHT_SLOPE_MAX_GRADE = 0.8
// 路面高度变化的最小阈值（米），用于坡度判断
const ROAD_HEIGHT_SLOPE_MIN_DELTA_Y = 0.03
// 路面碰撞瓦片重叠长度（米），用于碰撞检测连续性
const ROAD_COLLISION_TILE_OVERLAP_METERS = 0.5
// 高程场最小行数，保证分辨率
const ROAD_HEIGHTFIELD_MIN_ROWS = 24
// 高程场最大行数，防止内存溢出
const ROAD_HEIGHTFIELD_MAX_ROWS = 128
// 高程场最小瓦片长度（米）
const ROAD_HEIGHTFIELD_MIN_TILE_LENGTH = 4
// 高程场最大瓦片长度（米）
const ROAD_HEIGHTFIELD_MAX_TILE_LENGTH = 32
// 高程场默认瓦片长度（米）
const ROAD_HEIGHTFIELD_DEFAULT_TILE_LENGTH = 12
// 矩形路面最大几何细节（米），用于LOD控制
const ROAD_RECTANGULAR_MAX_GEOMETRY_DETAIL = 0.18
// 矩形路面最大高度细节（米），用于LOD控制
const ROAD_RECTANGULAR_MAX_HEIGHT_DETAIL = 0.18
// 矩形路面最大高度范围（米），用于高度变化限制
const ROAD_RECTANGULAR_MAX_HEIGHT_RANGE = 0.12
// 矩形路面最小厚度（米），防止过薄
const ROAD_RECTANGULAR_MIN_THICKNESS = 0.08
// 矩形路面最大厚度（米），防止过厚
const ROAD_RECTANGULAR_MAX_THICKNESS = 0.28
// 路面连接盒重叠长度（米），用于连接平滑
const ROAD_BOX_JOIN_MIN_OVERLAP_METERS = 0.14
// 璺潰鐩掗噸鍙犻暱搴︾殑鏈€澶у€�锛堢背锛?
const ROAD_BOX_JOIN_MAX_OVERLAP_METERS = 0.55

// Road collision uses tiled heightfields exclusively.
// Tile length is adaptively reduced on bends to keep chord approximation tight.
const ROAD_TILE_MAX_HEADING_DELTA_RAD = (8 * Math.PI) / 180

function normalizeAngleRad(angle: number): number {
	if (!Number.isFinite(angle)) {
		return 0
	}
	let value = angle
	while (value > Math.PI) {
		value -= Math.PI * 2
	}
	while (value < -Math.PI) {
		value += Math.PI * 2
	}
	return value
}

function computeHeadingDeltaRad(curve: THREE.Curve<THREE.Vector3>, startU: number, endU: number): number {
	const t0 = curve.getTangent(Math.max(0, Math.min(1, startU)))
	t0.y = 0
	const t1 = curve.getTangent(Math.max(0, Math.min(1, endU)))
	t1.y = 0
	const a0 = Math.atan2(t0.x, t0.z)
	const a1 = Math.atan2(t1.x, t1.z)
	return Math.abs(normalizeAngleRad(a1 - a0))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
	return Math.max(min, Math.min(max, numeric))
}

function lerpNumber(start: number, end: number, t: number): number {
	return start + (end - start) * t
}

function computeCurveGeometryDetailScore(curve: THREE.Curve<THREE.Vector3>, length: number): number {
	if (!Number.isFinite(length) || length <= ROAD_EPSILON) {
		return 0
	}
	const sampleCount = Math.max(4, Math.min(16, Math.ceil(length / 2)))
	const tangent = new THREE.Vector3()
	let previousHeading = 0
	let hasPreviousHeading = false
	let totalHeadingDelta = 0
	let maxHeadingDelta = 0
	for (let i = 0; i <= sampleCount; i += 1) {
		const u = i / sampleCount
		curve.getTangent(u, tangent)
		tangent.y = 0
		const heading = Math.atan2(tangent.x, tangent.z)
		if (hasPreviousHeading) {
			const delta = Math.abs(normalizeAngleRad(heading - previousHeading))
			totalHeadingDelta += delta
			maxHeadingDelta = Math.max(maxHeadingDelta, delta)
		}
		previousHeading = heading
		hasPreviousHeading = true
	}
	const totalTurnScore = Math.max(0, Math.min(1, totalHeadingDelta / Math.PI))
	const sharpTurnScore = Math.max(0, Math.min(1, maxHeadingDelta / ((10 * Math.PI) / 180)))
	return Math.max(0, Math.min(1, totalTurnScore * 0.65 + sharpTurnScore * 0.35))
}

function computeRoadHeightDetailScore(values: number[], length: number): number {
	if (!Number.isFinite(length) || length <= ROAD_EPSILON || values.length < 3) {
		return 0
	}
	const step = length / Math.max(1, values.length - 1)
	if (!Number.isFinite(step) || step <= ROAD_EPSILON) {
		return 0
	}
	let maxSlope = 0
	let maxDeltaSlope = 0
	for (let i = 1; i < values.length; i += 1) {
		const current = Number.isFinite(values[i]!) ? values[i]! : 0
		const previous = Number.isFinite(values[i - 1]!) ? values[i - 1]! : 0
		const slope = Math.abs(current - previous) / step
		maxSlope = Math.max(maxSlope, slope)
		if (i >= 2) {
			const beforePrevious = Number.isFinite(values[i - 2]!) ? values[i - 2]! : 0
			const previousSlope = Math.abs(previous - beforePrevious) / step
			maxDeltaSlope = Math.max(maxDeltaSlope, Math.abs(slope - previousSlope))
		}
	}
	const slopeScore = Math.max(0, Math.min(1, maxSlope / ROAD_HEIGHT_SLOPE_MAX_GRADE))
	const roughnessScore = Math.max(0, Math.min(1, maxDeltaSlope / Math.max(ROAD_HEIGHT_SLOPE_MIN_DELTA_Y, 0.15)))
	return Math.max(0, Math.min(1, slopeScore * 0.8 + roughnessScore * 0.2))
}

function computeRoadHeightRange(values: number[]): number {
	let min = Number.POSITIVE_INFINITY
	let max = Number.NEGATIVE_INFINITY
	for (const value of values) {
		const numeric = Number.isFinite(value) ? value : 0
		min = Math.min(min, numeric)
		max = Math.max(max, numeric)
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return 0
	}
	return max - min
}

function computeRoadHeightRangeForSpan(values: number[], startIndex: number, endIndex: number): number {
	const start = Math.max(0, Math.min(values.length, Math.trunc(startIndex)))
	const end = Math.max(start, Math.min(values.length, Math.trunc(endIndex)))
	let min = Number.POSITIVE_INFINITY
	let max = Number.NEGATIVE_INFINITY
	for (let i = start; i < end; i += 1) {
		const numeric = Number.isFinite(values[i]!) ? values[i]! : 0
		min = Math.min(min, numeric)
		max = Math.max(max, numeric)
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return 0
	}
	return max - min
}

type RoadCollisionSpan = {
	startIndex: number
	endIndex: number
	kind: 'box' | 'heightfield'
	boxOverlapMeters?: number
}

function collectRoadCollisionSpans(
	curve: THREE.Curve<THREE.Vector3>,
	divisions: number,
	heights: number[],
): RoadCollisionSpan[] {
	if (!(divisions > 0)) {
		return []
	}
	const intervalKinds: Array<'box' | 'heightfield'> = []
	const intervalGeometryDetails: number[] = []
	const intervalHeightDetails: number[] = []
	for (let i = 0; i < divisions; i += 1) {
		const startU = i / divisions
		const endU = (i + 1) / divisions
		const geometryDetail = computeHeadingDeltaRad(curve, startU, endU)
		const heightRange = computeRoadHeightRangeForSpan(heights, Math.max(0, i - 1), Math.min(heights.length, i + 2))
		const heightDetail = Math.max(0, Math.min(1, heightRange / Math.max(ROAD_RECTANGULAR_MAX_HEIGHT_RANGE, 1e-6)))
		intervalGeometryDetails.push(geometryDetail)
		intervalHeightDetails.push(heightDetail)
		const isBoxCandidate =
			geometryDetail <= ROAD_RECTANGULAR_MAX_GEOMETRY_DETAIL &&
			geometryDetail <= ROAD_TILE_MAX_HEADING_DELTA_RAD * 0.75 &&
			heightDetail <= ROAD_RECTANGULAR_MAX_HEIGHT_DETAIL &&
			heightRange <= ROAD_RECTANGULAR_MAX_HEIGHT_RANGE * 0.5
		intervalKinds.push(isBoxCandidate ? 'box' : 'heightfield')
	}
	const spans: RoadCollisionSpan[] = []
	let startIndex = 0
	while (startIndex < divisions) {
		const kind = intervalKinds[startIndex]!
		let endIndex = startIndex + 1
		while (endIndex < divisions && intervalKinds[endIndex] === kind) {
			endIndex += 1
		}
		if (kind === 'box' && endIndex - startIndex < 2) {
			spans.push({ startIndex, endIndex, kind: 'heightfield' })
		} else {
			spans.push({
				startIndex,
				endIndex,
				kind,
				boxOverlapMeters:
					kind === 'box'
						? computeRoadBoxJoinOverlapMeters(startIndex, endIndex, intervalGeometryDetails, intervalHeightDetails)
						: undefined,
			})
		}
		startIndex = endIndex
	}
	const promotedSpans: RoadCollisionSpan[] = []
	for (let index = 0; index < spans.length; index += 1) {
		const span = spans[index]!
		if (span.kind === 'heightfield') {
			const intervalCount = span.endIndex - span.startIndex
			const hasBoxNeighbor =
				promotedSpans[promotedSpans.length - 1]?.kind === 'box' ||
				spans[index + 1]?.kind === 'box'
			if (intervalCount <= 2 && hasBoxNeighbor) {
				promotedSpans.push({
					...span,
					kind: 'box',
					boxOverlapMeters: computeRoadBoxJoinOverlapMeters(
						span.startIndex,
						span.endIndex,
						intervalGeometryDetails,
						intervalHeightDetails,
					),
				})
				continue
			}
		}
		promotedSpans.push(span)
	}
	const mergedSpans: RoadCollisionSpan[] = []
	for (const span of promotedSpans) {
		const previous = mergedSpans[mergedSpans.length - 1]
		if (previous && previous.kind === span.kind) {
			previous.endIndex = span.endIndex
			if (previous.kind === 'box') {
				previous.boxOverlapMeters = Math.max(previous.boxOverlapMeters ?? 0, span.boxOverlapMeters ?? 0)
			}
			continue
		}
		mergedSpans.push({ ...span })
	}
	return mergedSpans.map((span) => {
		if (span.kind !== 'box') {
			return span
		}
		return {
			...span,
			boxOverlapMeters: computeRoadBoxJoinOverlapMeters(
				span.startIndex,
				span.endIndex,
				intervalGeometryDetails,
				intervalHeightDetails,
			),
		}
	})
}

function computeRoadBoxJoinOverlapMeters(
	startIndex: number,
	endIndex: number,
	intervalGeometryDetails: number[],
	intervalHeightDetails: number[],
): number {
	const start = Math.max(0, Math.min(intervalGeometryDetails.length, Math.trunc(startIndex)))
	const end = Math.max(start, Math.min(intervalGeometryDetails.length, Math.trunc(endIndex)))
	const intervalCount = Math.max(1, end - start)
	let geometryScoreSum = 0
	let heightScoreSum = 0
	for (let i = start; i < end; i += 1) {
		const geometryDetail = Number.isFinite(intervalGeometryDetails[i]!) ? intervalGeometryDetails[i]! : 0
		const heightDetail = Number.isFinite(intervalHeightDetails[i]!) ? intervalHeightDetails[i]! : 0
		geometryScoreSum += 1 - Math.max(0, Math.min(1, geometryDetail / Math.max(ROAD_RECTANGULAR_MAX_GEOMETRY_DETAIL, 1e-6)))
		heightScoreSum += 1 - Math.max(0, Math.min(1, heightDetail / Math.max(ROAD_RECTANGULAR_MAX_HEIGHT_DETAIL, 1e-6)))
	}
	const geometryScore = geometryScoreSum / intervalCount
	const heightScore = heightScoreSum / intervalCount
	const straightnessScore = Math.max(0, Math.min(1, geometryScore * 0.7 + heightScore * 0.3))
	const lengthScore = Math.max(0, Math.min(1, (intervalCount - 1) / 5))
	const adaptiveScore = Math.max(0, Math.min(1, straightnessScore * 0.75 + lengthScore * 0.25))
	return lerpNumber(ROAD_BOX_JOIN_MIN_OVERLAP_METERS, ROAD_BOX_JOIN_MAX_OVERLAP_METERS, adaptiveScore)
}
function computeRoadDivisions(length: number, samplingDensityFactor = 1.0): number {
	if (!Number.isFinite(length) || length <= ROAD_EPSILON) {
		return 0
	}
	const densityFactor = clampNumber(samplingDensityFactor, 0.1, 10, 1.0)
	return Math.max(
		ROAD_MIN_DIVISIONS,
		Math.min(ROAD_MAX_DIVISIONS, Math.ceil(length * ROAD_DIVISION_DENSITY * densityFactor)),
	)
}

function computeCornerMinSegments(junctionSmoothing = 0): number {
	const smoothing = clampNumber(junctionSmoothing, 0, 1, 0)
	const suggested = Math.round(12 + 12 * smoothing)
	return Math.max(6, Math.min(48, suggested))
}

function computeRoadDivisionsForCurve(
	curve: THREE.Curve<THREE.Vector3>,
	length: number,
	samplingDensityFactor = 1.0,
	junctionSmoothing = 0,
	geometryDetail = 0,
): number {
	let divisions = computeRoadDivisions(length, samplingDensityFactor)
	if (!(divisions > 0)) {
		return 0
	}
	const geometryScale = lerpNumber(0.3, 0.85, Math.max(0, Math.min(1, geometryDetail)))
	divisions = Math.max(ROAD_MIN_DIVISIONS, Math.min(ROAD_MAX_DIVISIONS, Math.round(divisions * geometryScale)))
	const curves = (curve as any)?.curves
	if (!Array.isArray(curves) || !curves.length) {
		return divisions
	}
	const cornerMinSegments = computeCornerMinSegments(junctionSmoothing)
	for (const segment of curves as Array<THREE.Curve<THREE.Vector3>>) {
		const isQuadratic = Boolean((segment as any)?.isQuadraticBezierCurve3)
		if (!isQuadratic) {
			continue
		}
		const cornerLength = segment.getLength()
		if (!Number.isFinite(cornerLength) || cornerLength <= ROAD_EPSILON) {
			continue
		}
		const requiredTotal = Math.ceil((cornerMinSegments * length) / cornerLength)
		if (Number.isFinite(requiredTotal)) {
			divisions = Math.max(divisions, requiredTotal)
		}
	}
	return Math.max(ROAD_MIN_DIVISIONS, Math.min(ROAD_MAX_DIVISIONS, divisions))
}

function computeHeightSmoothingPasses(divisions: number, strengthFactor = 1.0): number {
	if (!Number.isFinite(divisions) || divisions <= 0) {
		return ROAD_HEIGHT_SMOOTHING_MIN_PASSES
	}
	const factor = clampNumber(strengthFactor, 0.1, 5, 1.0)
	const suggested = Math.round((divisions / 12) * factor)
	return Math.max(ROAD_HEIGHT_SMOOTHING_MIN_PASSES, Math.min(ROAD_HEIGHT_SMOOTHING_MAX_PASSES, suggested))
}

function smoothHeightSeries(values: number[], passes: number, minimums: number[]): number[] {
	const count = values.length
	if (count <= 2 || minimums.length !== count) {
		return values.slice()
	}
	const iterations = Math.max(0, Math.min(12, Math.trunc(passes)))
	if (iterations === 0) {
		return values.slice()
	}
	let working = values.slice()
	for (let pass = 0; pass < iterations; pass += 1) {
		const next = working.slice()
		for (let i = 1; i < count - 1; i += 1) {
			const smoothed = (working[i - 1]! + working[i]! + working[i + 1]!) / 3
			next[i] = Math.max(minimums[i]!, smoothed)
		}
		next[0] = Math.max(minimums[0]!, next[0]!)
		next[count - 1] = Math.max(minimums[count - 1]!, next[count - 1]!)
		working = next
	}
	return working
}

function clampHeightSeriesSlope(values: number[], minimums: number[], maxDeltaY: number): number[] {
	const count = values.length
	if (count <= 2 || minimums.length !== count) {
		return values.slice()
	}
	const delta = Number.isFinite(maxDeltaY) ? Math.max(0, maxDeltaY) : 0
	if (delta <= 0) {
		return values.slice()
	}
	const working = values.slice()
	for (let i = 1; i < count; i += 1) {
		working[i] = Math.max(minimums[i]!, Math.min(working[i]!, working[i - 1]! + delta))
	}
	for (let i = count - 2; i >= 0; i -= 1) {
		working[i] = Math.max(minimums[i]!, Math.min(working[i]!, working[i + 1]! + delta))
	}
	return working
}

// Removed unused SanitizedRoadSegment type
// Removed unused road graph helpers: RoadBuildData, sanitizeRoadVertices, buildAdjacencyMap, collectRoadPaths
// Removed unused `collectRoadBuildData` helper.

type RoadCurveDescriptor = { curve: THREE.Curve<THREE.Vector3> }

function buildRoadCurvesFromGraph(smoothing: number, graph: RoadGraph): RoadCurveDescriptor[] {
	const junctionSmoothing = Math.max(0, Math.min(1, Number.isFinite(smoothing) ? smoothing : 0))
	const curves: RoadCurveDescriptor[] = []
	for (const edge of graph.edges) {
		const points = edge.indices
			.map((idx) => graph.vertices[idx] ?? null)
			.filter((p): p is THREE.Vector3 => Boolean(p))
		if (points.length < 2) {
			continue
		}
		curves.push({ curve: buildRoadCornerBezierCurvePath(points, edge.closed && points.length >= 3, junctionSmoothing) })
	}
	return curves
}

function collectRoadCurveSubsegments(curve: THREE.Curve<THREE.Vector3>): THREE.Curve<THREE.Vector3>[] {
	const subcurves = (curve as any)?.curves
	if (!Array.isArray(subcurves) || !subcurves.length) {
		return [curve]
	}
	return subcurves.filter((segment): segment is THREE.Curve<THREE.Vector3> => Boolean(segment))
}

// createRoadCurve removed (unused)

// Removed unused `buildRoadCurves` wrapper.

type RoadCenterlineHeightSeriesParams = {
	curve: THREE.Curve<THREE.Vector3>
	divisions: number
	heightSampler: (x: number, z: number) => number
	minClearance: number
	smoothingStrengthFactor: number
	smooth: boolean
}

function buildRoadCenterlineHeightSeries({
	curve,
	divisions,
	heightSampler,
	minClearance,
	smoothingStrengthFactor,
	smooth,
}: RoadCenterlineHeightSeriesParams): number[] {
	const values: number[] = []
	const minimums: number[] = []
	const center = new THREE.Vector3()
	for (let i = 0; i <= divisions; i += 1) {
		const u = i / divisions
		curve.getPoint(u, center)
		const hCenter = heightSampler(center.x, center.z)
		const baseHeight = Number.isFinite(hCenter) ? hCenter : 0
		const minHeight = baseHeight + Math.max(0, minClearance)
		const surface = minHeight + ROAD_SURFACE_Y_OFFSET
		values.push(surface)
		minimums.push(surface)
	}
	if (!smooth) {
		return values
	}
	const passes = computeHeightSmoothingPasses(divisions, smoothingStrengthFactor)
	let smoothed = smoothHeightSeries(values, passes, minimums)
	const stepDistance = curve.getLength() / divisions
	const maxDeltaY = Math.max(ROAD_HEIGHT_SLOPE_MIN_DELTA_Y, stepDistance * ROAD_HEIGHT_SLOPE_MAX_GRADE)
	smoothed = clampHeightSeriesSlope(smoothed, minimums, maxDeltaY)
	return smoothed
}

type HeightfieldFromSeriesParams = {
	startIndex: number
	endIndex: number
	rows: number
	elementSize: number
	roadWidth: number
	heights: number[]
}

type RoadRectangularTileShapeParams = {
	roadWidth: number
	length: number
	heights: number[]
}

function buildRoadRectangularTileShapeFromSeries({
	roadWidth,
	length,
	heights,
}: RoadRectangularTileShapeParams): RigidbodyPhysicsShape | null {
	if (!(roadWidth > ROAD_EPSILON) || !(length > ROAD_EPSILON) || heights.length < 2) {
		return null
	}
	const heightRange = computeRoadHeightRange(heights)
	if (!Number.isFinite(heightRange) || heightRange > ROAD_RECTANGULAR_MAX_HEIGHT_RANGE) {
		return null
	}
	const thickness = Math.max(
		ROAD_RECTANGULAR_MIN_THICKNESS,
		Math.min(
			ROAD_RECTANGULAR_MAX_THICKNESS,
			Math.max(ROAD_SURFACE_Y_OFFSET * 4, heightRange * 2 + 0.04),
		),
	)
	return {
		kind: 'box',
		halfExtents: [Math.max(1e-4, roadWidth * 0.5), Math.max(1e-4, thickness * 0.5), Math.max(1e-4, length * 0.5)],
		offset: [0, 0, 0],
		applyScale: false,
	}
}

function buildHeightfieldShapeFromSeries({
	startIndex,
	endIndex,
	rows,
	elementSize,
	roadWidth,
	heights,
}: HeightfieldFromSeriesParams): Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }> | null {
	const span = endIndex - startIndex
	if (span <= 0) {
		return null
	}
	const overlapRows = Math.max(1, Math.ceil(ROAD_COLLISION_TILE_OVERLAP_METERS / elementSize))
	const pointsX = Math.max(2, Math.ceil(Math.max(roadWidth, elementSize) / elementSize) + 1)
	const pointsZ = rows + 1 + overlapRows * 2
	if (pointsX < 2 || pointsZ < 2) {
		return null
	}
	const width = Math.max(1e-4, (pointsX - 1) * elementSize)
	const depth = Math.max(1e-4, (pointsZ - 1) * elementSize)
	const halfWidth = width * 0.5
	const halfDepth = depth * 0.5
	const matrix: number[][] = []
	for (let col = 0; col < pointsX; col += 1) {
		const columnValues: number[] = []
		for (let row = pointsZ - 1; row >= 0; row -= 1) {
			const innerRows = Math.max(1, pointsZ - 1 - overlapRows * 2)
			const uAlong = pointsZ > 1
				? Math.max(0, Math.min(1, (row - overlapRows) / innerRows))
				: 0
			const indexFloat = startIndex + uAlong * span
			const i0 = Math.max(0, Math.min(heights.length - 1, Math.floor(indexFloat)))
			const i1 = Math.max(0, Math.min(heights.length - 1, i0 + 1))
			const frac = indexFloat - i0
			const h0 = heights[i0] ?? 0
			const h1 = heights[i1] ?? h0
			const height = h0 + (h1 - h0) * frac
			columnValues.push(Number.isFinite(height) ? height : 0)
		}
		matrix.push(columnValues)
	}
	return {
		kind: 'heightfield',
		matrix,
		elementSize,
		width,
		depth,
		offset: [-halfWidth, -halfDepth, 0],
		applyScale: false,
	}
}

function buildRoadHeightfieldSignature(params: {
	definition: RoadDynamicMesh
	roadNode: SceneNode
	groundNode?: SceneNode | null
	roadWidth: number
	collisionWidth: number
	samplingDensityFactor: number
	smoothingStrengthFactor: number
	minClearance: number
	junctionSmoothing: number
	elementSize: number
	desiredTileLength: number
	bodyCount: number
	heightHash: number
	layoutHash: number
	boundaryWallEnabled: boolean
	boundaryWallProps: BoundaryWallComponentProps | null
}): string {
	const roadPosition = (params.roadNode.position as any) ?? {}
	const roadRotation = (params.roadNode.rotation as any) ?? {}
	const groundPosition = (params.groundNode?.position as any) ?? {}
	const rx = typeof roadPosition.x === 'number' && Number.isFinite(roadPosition.x) ? roadPosition.x : 0
	const ry = typeof roadPosition.y === 'number' && Number.isFinite(roadPosition.y) ? roadPosition.y : 0
	const rz = typeof roadPosition.z === 'number' && Number.isFinite(roadPosition.z) ? roadPosition.z : 0
	const yaw = typeof roadRotation.y === 'number' && Number.isFinite(roadRotation.y) ? roadRotation.y : 0
	const gx = typeof groundPosition.x === 'number' && Number.isFinite(groundPosition.x) ? groundPosition.x : 0
	const gy = typeof groundPosition.y === 'number' && Number.isFinite(groundPosition.y) ? groundPosition.y : 0
	const gz = typeof groundPosition.z === 'number' && Number.isFinite(groundPosition.z) ? groundPosition.z : 0
	const verticesCount = Array.isArray(params.definition.vertices) ? params.definition.vertices.length : 0
	const segmentsCount = Array.isArray(params.definition.segments) ? params.definition.segments.length : 0
	return [
		`road:${params.roadNode.id}`,
		`frame:chord`,
		`v:${verticesCount}`,
		`s:${segmentsCount}`,
		`w:${Math.round(params.roadWidth * 1000)}`,
		`cw:${Math.round(params.collisionWidth * 1000)}`,
		`jd:${Math.round(params.junctionSmoothing * 1000)}`,
		`sd:${Math.round(params.samplingDensityFactor * 1000)}`,
		`ss:${Math.round(params.smoothingStrengthFactor * 1000)}`,
		`mc:${Math.round(params.minClearance * 1000)}`,
		`tile:${Math.round(params.desiredTileLength * 1000)}`,
		`es:${Math.round(params.elementSize * 1000)}`,
		`b:${params.bodyCount}`,
		`rh:${params.heightHash.toString(16)}`,
		`lh:${params.layoutHash.toString(16)}`,
		`bw:${params.boundaryWallEnabled ? 1 : 0}`,
		`bwh:${Math.round((params.boundaryWallProps?.height ?? 0) * 1000)}`,
		`bwt:${Math.round((params.boundaryWallProps?.thickness ?? 0) * 1000)}`,
		`bwo:${Math.round((params.boundaryWallProps?.offset ?? 0) * 1000)}`,
		`rp:${Math.round(rx * 1000)},${Math.round(ry * 1000)},${Math.round(rz * 1000)}`,
		`ry:${Math.round(yaw * 1000)}`,
		`gp:${Math.round(gx * 1000)},${Math.round(gy * 1000)},${Math.round(gz * 1000)}`,
	].join('|')
}

